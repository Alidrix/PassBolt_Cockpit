from __future__ import annotations

import json
import os
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import gnupg
import pyotp
import requests


@dataclass
class DiagnosticStep:
    id: str
    label: str
    status: str = "skipped"
    started_at: str | None = None
    finished_at: str | None = None
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    http_status: int | None = None
    endpoint: str | None = None
    remediation: str | None = None

    def start(self) -> None:
        self.started_at = datetime.now(timezone.utc).isoformat()

    def done(self, status: str, message: str, **kwargs: Any) -> None:
        self.status = status
        self.message = message
        self.finished_at = datetime.now(timezone.utc).isoformat()
        for key, value in kwargs.items():
            setattr(self, key, value)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "message": self.message,
            "details": self.details,
            "http_status": self.http_status,
            "endpoint": self.endpoint,
            "remediation": self.remediation,
        }


def _now_plus(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _extract_message(payload: Any, fallback: str = "") -> str:
    if isinstance(payload, dict):
        for key in ("message", "error", "detail"):
            if payload.get(key):
                return str(payload.get(key))
        body = payload.get("body")
        if isinstance(body, dict):
            for key in ("message", "error", "detail"):
                if body.get(key):
                    return str(body.get(key))
    return fallback


def parse_dry_run_message(payload: dict[str, Any], fallback: str = "Dry-run rejected") -> str:
    body = payload.get("body") if isinstance(payload, dict) else None
    candidates: list[str] = []
    if isinstance(body, dict):
        for key in ("message", "error", "reason"):
            if body.get(key):
                candidates.append(str(body.get(key)))
        errors = body.get("errors")
        if isinstance(errors, dict):
            for _, value in errors.items():
                if isinstance(value, list):
                    candidates.extend(str(v) for v in value if v)
                elif value:
                    candidates.append(str(value))
    candidates.append(_extract_message(payload, ""))
    normalized = " ".join(x for x in candidates if x).lower()
    if "sole" in normalized and "owner" in normalized:
        return "Suppression impossible : l'utilisateur/groupe est encore propriétaire unique de ressources"
    if "transfer" in normalized:
        return "Suppression impossible : des transferts de propriété sont nécessaires"
    if "depend" in normalized:
        return "Suppression impossible : des dépendances restantes bloquent l'opération"
    return next((x for x in candidates if x), fallback)


class PassboltApiAuthService:
    def __init__(self, logger: Any | None = None) -> None:
        self.base_url = (os.getenv("PASSBOLT_API_BASE_URL", "") or os.getenv("PASSBOLT_URL", "")).rstrip("/")
        self.auth_mode = (os.getenv("PASSBOLT_API_AUTH_MODE", "jwt") or "jwt").strip().lower()
        self.user_id = (os.getenv("PASSBOLT_API_USER_ID", "") or "").strip()
        self.private_key_path = (os.getenv("PASSBOLT_API_PRIVATE_KEY_PATH", "/app/keys/admin-private.asc") or "").strip()
        self.passphrase = os.getenv("PASSBOLT_API_PASSPHRASE", "")
        self.verify_tls = (os.getenv("PASSBOLT_API_VERIFY_TLS", "true").lower() not in {"0", "false", "no"})
        self.ca_bundle = (os.getenv("PASSBOLT_API_CA_BUNDLE", "") or "").strip()
        self.mfa_provider = (os.getenv("PASSBOLT_API_MFA_PROVIDER", "totp") or "totp").strip().lower()
        self.totp_secret = (os.getenv("PASSBOLT_API_TOTP_SECRET", "") or "").strip()
        self.timeout = int(os.getenv("PASSBOLT_API_TIMEOUT", "30"))
        self._session = requests.Session()
        self._tokens: dict[str, Any] = {}
        self._logger = logger
        self.verify_setting = self.ca_bundle if self.ca_bundle and os.path.exists(self.ca_bundle) else self.verify_tls

    def _log(self, level: str, message: str, **details: Any) -> None:
        if self._logger:
            self._logger(level, message, **details)

    def enabled(self) -> bool:
        return all([self.base_url, self.user_id, self.private_key_path, self.passphrase])

    def config_status(self) -> dict[str, Any]:
        checks = {
            "base_url": bool(self.base_url),
            "user_id": bool(self.user_id),
            "private_key_path": bool(self.private_key_path),
            "private_key_exists": bool(self.private_key_path and os.path.exists(self.private_key_path)),
            "passphrase": bool(self.passphrase),
            "ca_bundle_configured": bool(self.ca_bundle),
            "ca_bundle_exists": bool(self.ca_bundle and os.path.exists(self.ca_bundle)),
            "totp_secret": bool(self.totp_secret),
        }
        return {
            "configured": all(checks[k] for k in ("base_url", "user_id", "private_key_path", "private_key_exists", "passphrase")),
            "checks": checks,
            "message": "Configuration API Passbolt incomplète" if not all(checks[k] for k in ("base_url", "user_id", "private_key_exists", "passphrase")) else "Configuration minimale détectée",
        }

    def _request_json(self, method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any], str, requests.Response | None]:
        url = f"{self.base_url}{path}"
        try:
            response = self._session.request(method, url, json=payload, timeout=self.timeout, verify=self.verify_setting, headers={"Accept": "application/json", "Content-Type": "application/json", **self._session.headers})
            data: dict[str, Any] = {}
            if response.text:
                try:
                    data = response.json()
                except Exception:
                    data = {}
            return response.status_code, data, response.text[:1000], response
        except requests.RequestException as error:
            return 0, {}, str(error), None

    def _gpg(self) -> gnupg.GPG:
        if not os.path.exists(self.private_key_path):
            raise RuntimeError(f"Clé privée API introuvable: {self.private_key_path}")
        gpg = gnupg.GPG(gnupghome="/tmp/gnupg-passbolt")
        with open(self.private_key_path, "r", encoding="utf-8") as handle:
            result = gpg.import_keys(handle.read())
        if not result.fingerprints:
            raise RuntimeError("Import de la clé privée impossible")
        return gpg

    def _fetch_server_public_key(self) -> str:
        self._log("info", "[INFO] Calling /auth/verify.json")
        status, payload, raw, response = self._request_json("GET", "/auth/verify.json")
        if status >= 400 or status == 0:
            raise RuntimeError(f"/auth/verify.json inaccessible: {raw or status}")
        body = payload.get("body") if isinstance(payload, dict) else None
        search_objects = [payload, body] if isinstance(body, dict) else [payload]
        for obj in search_objects:
            if not isinstance(obj, dict):
                continue
            for key in ("server_public_key", "public_key", "keydata", "armored_key"):
                value = obj.get(key)
                if isinstance(value, str) and "BEGIN PGP PUBLIC KEY BLOCK" in value:
                    return value
        if response is not None:
            key_url = response.headers.get("X-GPGAuth-Verify-Response")
            if key_url:
                key_resp = self._session.get(key_url, timeout=self.timeout, verify=self.verify_setting)
                if key_resp.ok and "BEGIN PGP PUBLIC KEY BLOCK" in key_resp.text:
                    return key_resp.text
        raise RuntimeError("Clé publique serveur introuvable")

    def _encrypt_for_server(self, gpg: gnupg.GPG, plaintext: str, server_public_key: str) -> str:
        imported = gpg.import_keys(server_public_key)
        if not imported.fingerprints:
            raise RuntimeError("Import de la clé publique serveur impossible")
        encrypted = gpg.encrypt(plaintext, recipients=imported.fingerprints, always_trust=True)
        if not encrypted.ok:
            raise RuntimeError(f"Chiffrement challenge échoué: {encrypted.status}")
        return str(encrypted)

    def _decrypt_payload(self, gpg: gnupg.GPG, encrypted: str) -> str:
        decrypted = gpg.decrypt(encrypted, passphrase=self.passphrase)
        if not decrypted.ok:
            raise RuntimeError(f"Déchiffrement échoué: {decrypted.status}")
        return str(decrypted)

    def _verify_mfa_if_required(self, login_payload: dict[str, Any]) -> None:
        providers = login_payload.get("mfa_providers") or (login_payload.get("body", {}) if isinstance(login_payload.get("body"), dict) else {}).get("mfa_providers")
        if not providers:
            return
        if self.mfa_provider != "totp":
            raise RuntimeError("MFA requis mais provider non supporté")
        if not self.totp_secret:
            raise RuntimeError("MFA requis mais PASSBOLT_API_TOTP_SECRET absent")
        code = pyotp.TOTP(self.totp_secret.replace(" ", "")).now()
        status, payload, raw, _ = self._request_json("POST", "/mfa/verify/totp.json", {"totp": code})
        if status >= 400:
            raise RuntimeError(_extract_message(payload, raw or "MFA verification failed: invalid TOTP"))

    def authenticate(self) -> dict[str, Any]:
        if self.auth_mode != "jwt":
            raise RuntimeError("Only PASSBOLT_API_AUTH_MODE=jwt is supported")
        if not self.enabled():
            raise RuntimeError("Passbolt API is not configured")

        gpg = self._gpg()
        server_public_key = self._fetch_server_public_key()
        verify_token = secrets.token_urlsafe(32)
        challenge = {
            "version": "1.0.0",
            "domain": self.base_url,
            "verify_token": verify_token,
            "verify_token_expiry": _now_plus(5),
        }
        signed = gpg.sign(json.dumps(challenge), clearsign=False, detach=True, passphrase=self.passphrase)
        if not signed:
            raise RuntimeError("Signature du challenge JWT impossible")
        envelope = {
            "user_id": self.user_id,
            "challenge": challenge,
            "challenge_signature": str(signed),
        }
        encrypted = self._encrypt_for_server(gpg, json.dumps(envelope), server_public_key)

        status, login_payload, raw, _ = self._request_json("POST", "/auth/jwt/login.json", {"challenge": encrypted, "user_id": self.user_id})
        if status >= 400 or status == 0:
            raise RuntimeError(_extract_message(login_payload, raw or f"JWT login failed HTTP {status}"))

        body = login_payload.get("body") if isinstance(login_payload, dict) else None
        decrypted_raw = ""
        if isinstance(body, str) and "BEGIN PGP MESSAGE" in body:
            decrypted_raw = self._decrypt_payload(gpg, body)
        elif isinstance(body, dict):
            decrypted_raw = json.dumps(body)
        else:
            decrypted_raw = json.dumps(login_payload)

        token_payload = json.loads(decrypted_raw)
        returned_verify_token = token_payload.get("verify_token")
        if returned_verify_token and returned_verify_token != verify_token:
            raise RuntimeError("verify_token mismatch")

        access_token = token_payload.get("access_token") or token_payload.get("token")
        refresh_token = token_payload.get("refresh_token")
        if not access_token:
            raise RuntimeError("Missing access_token after JWT login")
        self._tokens = {"access_token": access_token, "refresh_token": refresh_token}
        self._session.headers.update({"Authorization": f"Bearer {access_token}"})
        self._verify_mfa_if_required(token_payload)
        return self._tokens

    def run_diagnostic(self) -> dict[str, Any]:
        steps = [
            DiagnosticStep("config", "Validation de la configuration minimale"),
            DiagnosticStep("network", "Accessibilité réseau de l'URL Passbolt"),
            DiagnosticStep("tls", "Validation TLS / CA bundle"),
            DiagnosticStep("verify", "Appel de /auth/verify.json"),
            DiagnosticStep("server_key", "Récupération de la clé publique serveur"),
            DiagnosticStep("private_key", "Lecture de la clé privée locale"),
            DiagnosticStep("challenge", "Génération / signature / chiffrement du challenge JWT"),
            DiagnosticStep("jwt_login", "Login JWT"),
            DiagnosticStep("verify_token", "Validation du verify_token"),
            DiagnosticStep("mfa", "Validation MFA"),
            DiagnosticStep("authenticated", "Test endpoint protégé /auth/is-authenticated.json"),
            DiagnosticStep("groups", "Accès /groups.json"),
            DiagnosticStep("healthcheck", "Accès /healthcheck.json"),
            DiagnosticStep("permissions", "Vérification permissions groupes/suppression"),
        ]
        report = {"overall_status": "error", "steps": []}

        def finalize() -> dict[str, Any]:
            report["steps"] = [s.to_dict() for s in steps]
            if any(s.status == "error" for s in steps):
                report["overall_status"] = "error"
            elif any(s.status == "warning" for s in steps):
                report["overall_status"] = "warning"
            else:
                report["overall_status"] = "ok"
            return report

        try:
            s = steps[0]; s.start()
            cfg = self.config_status()
            if not cfg["configured"]:
                s.done("error", "Configuration minimale manquante", details=cfg, remediation="Configurer PASSBOLT_API_BASE_URL, PASSBOLT_API_USER_ID, PASSBOLT_API_PRIVATE_KEY_PATH, PASSBOLT_API_PASSPHRASE")
                return finalize()
            s.done("success", "Configuration minimale détectée", details=cfg)

            s = steps[1]; s.start()
            try:
                resp = self._session.get(self.base_url, timeout=self.timeout, verify=self.verify_setting)
                s.done("success", "Connectivité réseau OK", http_status=resp.status_code, endpoint=self.base_url)
            except requests.RequestException as error:
                s.done("error", "Connexion réseau impossible", details={"error": str(error)}, remediation="Vérifier DNS/pare-feu et PASSBOLT_API_BASE_URL")
                return finalize()

            s = steps[2]; s.start()
            if self.verify_setting is False:
                s.done("warning", "Validation TLS désactivée", details={"verify": False}, remediation="Activer PASSBOLT_API_VERIFY_TLS et configurer PASSBOLT_API_CA_BUNDLE")
            elif isinstance(self.verify_setting, str) and not os.path.exists(self.verify_setting):
                s.done("error", "CA bundle introuvable", details={"ca_bundle": self.verify_setting}, remediation="Corriger PASSBOLT_API_CA_BUNDLE")
                return finalize()
            else:
                s.done("success", "Connexion TLS réussie", details={"verify": self.verify_setting})

            s = steps[3]; s.start()
            status, payload, raw, _ = self._request_json("GET", "/auth/verify.json")
            if status >= 400 or status == 0:
                s.done("error", "/auth/verify.json inaccessible", http_status=status or None, endpoint="/auth/verify.json", details={"error": _extract_message(payload, raw)})
                return finalize()
            s.done("success", "/auth/verify.json accessible", http_status=status, endpoint="/auth/verify.json")

            s = steps[4]; s.start()
            server_key = self._fetch_server_public_key()
            s.done("success", "Clé publique serveur récupérée", details={"length": len(server_key)})

            s = steps[5]; s.start()
            gpg = self._gpg()
            s.done("success", "Clé privée API chargée")

            verify_token = secrets.token_urlsafe(32)
            challenge_payload = {"version": "1.0.0", "domain": self.base_url, "verify_token": verify_token, "verify_token_expiry": _now_plus(5)}

            s = steps[6]; s.start()
            signed = gpg.sign(json.dumps(challenge_payload), clearsign=False, detach=True, passphrase=self.passphrase)
            if not signed:
                s.done("error", "Signature challenge JWT échouée")
                return finalize()
            encrypted = self._encrypt_for_server(gpg, json.dumps({"user_id": self.user_id, "challenge": challenge_payload, "challenge_signature": str(signed)}), server_key)
            s.done("success", "Challenge JWT généré")

            s = steps[7]; s.start()
            status, login_payload, raw, _ = self._request_json("POST", "/auth/jwt/login.json", {"challenge": encrypted, "user_id": self.user_id})
            if status >= 400 or status == 0:
                s.done("error", "JWT login échoué", http_status=status or None, endpoint="/auth/jwt/login.json", details={"error": _extract_message(login_payload, raw)})
                return finalize()
            s.done("success", "Authentification API réussie", http_status=status, endpoint="/auth/jwt/login.json")

            body = login_payload.get("body") if isinstance(login_payload, dict) else None
            if isinstance(body, str) and "BEGIN PGP MESSAGE" in body:
                token_payload = json.loads(self._decrypt_payload(gpg, body))
            elif isinstance(body, dict):
                token_payload = body
            else:
                token_payload = login_payload

            s = steps[8]; s.start()
            response_verify_token = token_payload.get("verify_token")
            if response_verify_token and response_verify_token != verify_token:
                s.done("error", "verify_token mismatch", details={"sent": verify_token, "received": response_verify_token})
                return finalize()
            s.done("success", "verify_token validé")

            access_token = token_payload.get("access_token") or token_payload.get("token")
            if not access_token:
                steps[7].status = "error"
                steps[7].message = "Réponse login sans access_token"
                return finalize()
            self._session.headers.update({"Authorization": f"Bearer {access_token}"})

            s = steps[9]; s.start()
            try:
                self._verify_mfa_if_required(token_payload)
                if token_payload.get("mfa_providers"):
                    s.done("success", "MFA TOTP validé")
                else:
                    s.done("skipped", "MFA non requis")
            except Exception as error:
                s.done("error", str(error), remediation="Vérifier PASSBOLT_API_TOTP_SECRET")
                return finalize()

            s = steps[10]; s.start()
            status, payload, raw, _ = self._request_json("GET", "/auth/is-authenticated.json")
            if status >= 400 or status == 0:
                s.done("warning", "Endpoint /auth/is-authenticated.json indisponible", http_status=status or None, endpoint="/auth/is-authenticated.json", details={"error": _extract_message(payload, raw)})
            else:
                s.done("success", "Session authentifiée", http_status=status, endpoint="/auth/is-authenticated.json")

            s = steps[11]; s.start()
            status, payload, raw, _ = self._request_json("GET", "/groups.json")
            if status >= 400 or status == 0:
                s.done("error", "Accès /groups.json refusé", http_status=status or None, endpoint="/groups.json", details={"error": _extract_message(payload, raw)}, remediation="Vérifier permissions du compte API")
                return finalize()
            s.done("success", "/groups.json accessible", http_status=status, endpoint="/groups.json")

            s = steps[12]; s.start()
            status, payload, raw, _ = self._request_json("GET", "/healthcheck.json")
            if status >= 400 or status == 0:
                s.done("warning", "/healthcheck.json inaccessible à ce rôle", http_status=status or None, endpoint="/healthcheck.json", details={"error": _extract_message(payload, raw)})
            else:
                s.done("success", "/healthcheck.json accessible", http_status=status, endpoint="/healthcheck.json")

            s = steps[13]; s.start()
            status, payload, raw, _ = self._request_json("DELETE", f"/groups/{quote('00000000-0000-0000-0000-000000000000')}/dry-run.json")
            if status in (401, 403):
                s.done("error", "Compte API authentifié mais permissions insuffisantes", http_status=status, endpoint="/groups/{id}/dry-run.json", details={"error": _extract_message(payload, raw)})
            else:
                s.done("success", "Permissions API groupes/suppression vérifiables", http_status=status or None)
        except Exception as error:
            for step in steps:
                if step.started_at and not step.finished_at:
                    step.done("error", str(error))
                    break
        return finalize()


class PassboltGroupService:
    def __init__(self, auth_service: PassboltApiAuthService) -> None:
        self.auth = auth_service
        self.session = auth_service._session
        self.base_url = auth_service.base_url

    def enabled(self) -> bool:
        return self.auth.enabled()

    def authenticate(self) -> dict[str, Any]:
        return self.auth.authenticate()

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any], str]:
        status, data, raw, _ = self.auth._request_json(method, path, payload)
        return status, data, _extract_message(data, raw)

    def _extract_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        body = payload.get("body") if isinstance(payload, dict) else None
        if isinstance(body, list):
            return [x for x in body if isinstance(x, dict)]
        if isinstance(body, dict):
            for key in ("items", "data", "groups", "users"):
                if isinstance(body.get(key), list):
                    return [x for x in body.get(key) if isinstance(x, dict)]
        for key in ("items", "data", "groups", "users"):
            if isinstance(payload.get(key), list):
                return [x for x in payload.get(key) if isinstance(x, dict)]
        return []

    def list_groups(self) -> dict[str, Any]:
        status, payload, message = self._request("GET", "/groups.json")
        groups = self._extract_items(payload)
        if status >= 400:
            return {"result": {"returncode": 1, "stderr": message, "stdout": ""}, "groups": set(), "items": []}
        return {"result": {"returncode": 0, "stderr": "", "stdout": "ok"}, "groups": {str(g.get("name") or "") for g in groups if g.get("name")}, "items": groups}

    def get_group_by_name(self, name: str) -> dict[str, Any] | None:
        status, payload, message = self._request("GET", f"/groups.json?filter[search]={quote(name)}")
        if status >= 400:
            raise RuntimeError(message or f"group lookup failed HTTP {status}")
        for item in self._extract_items(payload):
            if str(item.get("name") or "").strip().lower() == name.lower():
                return item
        return None

    def create_group(self, group_name: str) -> dict[str, Any]:
        status, _, message = self._request("POST", "/groups.json", {"name": group_name})
        return {"returncode": 0 if status < 300 else 1, "stdout": "created" if status < 300 else "", "stderr": "" if status < 300 else message}

    def find_user_by_email(self, email: str) -> dict[str, Any] | None:
        status, payload, message = self._request("GET", f"/users.json?filter[search]={quote(email)}")
        if status >= 400:
            raise RuntimeError(message or f"user lookup failed HTTP {status}")
        for item in self._extract_items(payload):
            if str(item.get("username") or item.get("email") or "").lower() == email.lower():
                return item
        return None

    def assign_user_to_group(self, user_id: str, group_id: str) -> dict[str, Any]:
        status, payload, message = self._request("GET", f"/groups/{group_id}.json")
        if status >= 400:
            return {"returncode": 1, "stdout": "", "stderr": message}
        body = payload.get("body") if isinstance(payload, dict) and isinstance(payload.get("body"), dict) else payload
        members = body.get("groups_users") if isinstance(body, dict) and isinstance(body.get("groups_users"), list) else []
        if any(str(member.get("user_id")) == str(user_id) and not member.get("delete") for member in members if isinstance(member, dict)):
            return {"returncode": 0, "stdout": "already assigned", "stderr": ""}
        members.append({"user_id": user_id, "is_admin": False})
        update_payload = {"name": body.get("name"), "groups_users": members}
        status, _, message = self._request("PUT", f"/groups/{group_id}.json", update_payload)
        return {"returncode": 0 if status < 300 else 1, "stdout": "assigned" if status < 300 else "", "stderr": "" if status < 300 else message}


class PassboltDeleteService:
    def __init__(self, auth_service: PassboltApiAuthService) -> None:
        self.auth = auth_service
        self.session = auth_service._session

    def enabled(self) -> bool:
        return self.auth.enabled()

    def authenticate(self) -> dict[str, Any]:
        return self.auth.authenticate()

    def _request(self, method: str, path: str) -> tuple[int, dict[str, Any], str]:
        status, payload, raw, _ = self.auth._request_json(method, path)
        return status, payload, _extract_message(payload, raw)

    def _extract_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        body = payload.get("body") if isinstance(payload, dict) else None
        if isinstance(body, list):
            return [x for x in body if isinstance(x, dict)]
        if isinstance(body, dict):
            for key in ("items", "users", "data"):
                if isinstance(body.get(key), list):
                    return [x for x in body.get(key) if isinstance(x, dict)]
        for key in ("items", "users", "data"):
            if isinstance(payload.get(key), list):
                return [x for x in payload.get(key) if isinstance(x, dict)]
        return []

    def find_user_by_email(self, email: str) -> dict[str, Any] | None:
        status, payload, message = self._request("GET", f"/users.json?filter[search]={quote(email)}")
        if status >= 400:
            raise RuntimeError(message or f"lookup failed HTTP {status}")
        for item in self._extract_items(payload):
            username = str(item.get("username") or item.get("email") or "").lower()
            if username == email.lower():
                return item
        return None

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        status, payload, message = self._request("GET", f"/users/{user_id}.json")
        if status >= 400:
            raise RuntimeError(message or f"get user failed HTTP {status}")
        return payload.get("body") if isinstance(payload, dict) and isinstance(payload.get("body"), dict) else payload

    def _resolve_role(self, user_payload: dict[str, Any]) -> str:
        role = user_payload.get("role")
        if isinstance(role, dict):
            return str(role.get("name") or role.get("slug") or "unknown").lower()
        if isinstance(role, str):
            return role.lower()
        return str(user_payload.get("role_name") or user_payload.get("role_slug") or "unknown").lower()

    def _resolve_activation_state(self, user_payload: dict[str, Any], fallback: str | None = None) -> str:
        if user_payload.get("deleted") in (True, 1, "1"):
            return "deleted"
        if user_payload.get("disabled") in (True, 1, "1"):
            return "disabled"
        if user_payload.get("active") in (True, 1, "1"):
            return "active"
        if user_payload.get("active") in (False, 0, "0"):
            return "pending"
        return (fallback or "unknown").lower()

    def delete_user_dry_run(self, user_id: str) -> tuple[bool, str, dict[str, Any]]:
        status, payload, message = self._request("DELETE", f"/users/{user_id}/dry-run.json")
        return status < 300, parse_dry_run_message(payload, message), payload

    def delete_user(self, user_id: str) -> tuple[bool, str, dict[str, Any]]:
        status, payload, message = self._request("DELETE", f"/users/{user_id}.json")
        return status < 300, message, payload

    def delete_group_dry_run(self, group_id: str) -> tuple[bool, str, dict[str, Any]]:
        status, payload, message = self._request("DELETE", f"/groups/{group_id}/dry-run.json")
        return status < 300, parse_dry_run_message(payload, message), payload
