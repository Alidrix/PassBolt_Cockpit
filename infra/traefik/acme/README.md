# Traefik ACME storage

Create `acme.json` at runtime and keep permissions strict:

```bash
touch infra/traefik/acme/acme.json
chmod 600 infra/traefik/acme/acme.json
```
