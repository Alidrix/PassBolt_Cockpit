# Production Traefik + Cloudflare

## 1. Pré-requis serveur
Docker + Docker Compose plugin, ports 80/443 ouverts.

## 2. DNS Cloudflare
Apex A record + CNAME www/api/traefik vers le domaine apex, tous en proxied.

## 3. Token API Cloudflare
Créer un token limité: Zone DNS Edit + Zone Read sur la zone cible.

## 4. Variables `.env.production`
Copier `.env.production.example` puis renseigner domaines, token, et auth dashboard.

## 5. Démarrage Traefik
`./scripts/prod-up.sh`

## 6. Vérification certificats
Vérifier `docker compose ... logs traefik` et présence des certificats dans `acme.json`.

## 7. Mode SSL Full strict
Cloudflare > SSL/TLS > Full (strict), activer Always Use HTTPS.

## 8. Vérifications API
`./scripts/prod-check.sh`

## 9. Logs Traefik
`./scripts/prod-logs.sh traefik`

## 10. Rollback
`./scripts/prod-down.sh` puis redéployer version précédente.

## 11. Backup / Restore
Sauvegarder `.env.production` et `infra/traefik/acme/acme.json`.

## 12. Sécurité
Seul Traefik expose 80/443. Les services internes restent sur réseau privé.

## 13. Dépannage
### Erreur Cloudflare 525
Traefik ne répond pas encore en HTTPS, certificat non prêt, ou 443 fermé.

### Erreur Cloudflare 526
Full strict actif mais certificat origin invalide/non émis pour l’hôte.

### Certificat Let’s Encrypt non généré
Vérifier `CF_DNS_API_TOKEN`, permissions, DNS, logs Traefik, et chmod 600 sur `acme.json`.
