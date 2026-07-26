# InfraAtlas — Οδηγός Reverse Proxy

Το InfraAtlas τρέχει ως αυτόνομος Go HTTP server. Για να εκτεθεί μέσω domain
χρειάζεται έναν reverse proxy μπροστά του. Ο οδηγός καλύπτει τρεις δημοφιλείς
επιλογές (**Caddy**, **Traefik**, **Nginx**) και δύο σενάρια ανάπτυξης:

| Σενάριο | URL | Σημείωση |
|---|---|---|
| **Subdomain** | `infra.iosifidis.gr` | Απλούστερο — συνιστάται |
| **Subpath** | `iosifidis.gr/infra` | Απαιτεί **path stripping** στον proxy |

> [!IMPORTANT]
> Στο σενάριο **Subpath** ο proxy **πρέπει** να αφαιρεί το prefix `/infra` πριν
> προωθήσει το request στον Go server. Χωρίς αυτό η εφαρμογή θα σπάσει (404 σε
> όλα τα API calls).

---

## Εκκίνηση του Go Server

```bash
# Βασική εκκίνηση (port 8080, db στο ./data/)
./vm-dashboard

# Με custom port και path βάσης δεδομένων
./vm-dashboard --port 8080 --db /var/lib/infraatlas/dashboard.db
```

### Systemd Service (προαιρετικό)

```ini
# /etc/systemd/system/infraatlas.service
[Unit]
Description=InfraAtlas Dashboard
After=network.target

[Service]
Type=simple
User=infraatlas
WorkingDirectory=/opt/infraatlas
ExecStart=/opt/infraatlas/vm-dashboard --port 8080 --db /var/lib/infraatlas/dashboard.db
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now infraatlas
```

---

## Caddy

Το Caddy διαχειρίζεται αυτόματα TLS μέσω Let's Encrypt.

### Subdomain

```caddyfile
infra.iosifidis.gr {
    reverse_proxy localhost:8080
}
```

### Subpath

```caddyfile
iosifidis.gr {
    # Άλλα routes του κύριου site...

    handle /infra/* {
        uri strip_prefix /infra
        reverse_proxy localhost:8080
    }
}
```

> [!NOTE]
> Το `uri strip_prefix /infra` αφαιρεί το prefix. Ο Go server λαμβάνει
> `/api/vms` αντί για `/infra/api/vms` — ακριβώς αυτό που χρειάζεται.

---

## Traefik

Παρουσιάζονται δύο τρόποι: **Docker labels** (αν τρέχεις σε container) και
**static/dynamic config** (αν τρέχεις ως binary).

### Subdomain — Docker labels

```yaml
# docker-compose.yml
services:
  infraatlas:
    image: infraatlas:latest   # ή build: .
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.infraatlas.rule=Host(`infra.iosifidis.gr`)"
      - "traefik.http.routers.infraatlas.entrypoints=websecure"
      - "traefik.http.routers.infraatlas.tls.certresolver=letsencrypt"
      - "traefik.http.services.infraatlas.loadbalancer.server.port=8080"
```

### Subpath — Docker labels

```yaml
services:
  infraatlas:
    image: infraatlas:latest
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      # Router: match host + path prefix
      - "traefik.http.routers.infraatlas.rule=Host(`iosifidis.gr`) && PathPrefix(`/infra`)"
      - "traefik.http.routers.infraatlas.entrypoints=websecure"
      - "traefik.http.routers.infraatlas.tls.certresolver=letsencrypt"
      # Middleware: strip the /infra prefix
      - "traefik.http.middlewares.infraatlas-strip.stripprefix.prefixes=/infra"
      - "traefik.http.routers.infraatlas.middlewares=infraatlas-strip"
      - "traefik.http.services.infraatlas.loadbalancer.server.port=8080"
```

### Subdomain — Dynamic config (binary / bare metal)

```yaml
# /etc/traefik/dynamic/infraatlas.yml
http:
  routers:
    infraatlas:
      rule: "Host(`infra.iosifidis.gr`)"
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      service: infraatlas

  services:
    infraatlas:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:8080"
```

### Subpath — Dynamic config (binary / bare metal)

```yaml
# /etc/traefik/dynamic/infraatlas.yml
http:
  routers:
    infraatlas:
      rule: "Host(`iosifidis.gr`) && PathPrefix(`/infra`)"
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - infraatlas-strip
      service: infraatlas

  middlewares:
    infraatlas-strip:
      stripPrefix:
        prefixes:
          - "/infra"

  services:
    infraatlas:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:8080"
```

---

## Nginx

### Subdomain

```nginx
server {
    listen 80;
    server_name infra.iosifidis.gr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name infra.iosifidis.gr;

    ssl_certificate     /etc/letsencrypt/live/infra.iosifidis.gr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/infra.iosifidis.gr/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### Subpath

```nginx
server {
    listen 443 ssl;
    server_name iosifidis.gr;

    # ... υπόλοιπες ρυθμίσεις SSL & site ...

    # Κρίσιμο: trailing slash στο proxy_pass κάνει το path stripping
    location /infra/ {
        proxy_pass         http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

> [!WARNING]
> Στο Nginx το **trailing slash** και στα δύο (`/infra/` και `http://127.0.0.1:8080/`)
> είναι αυτό που κάνει το path stripping. Αν αφαιρεθεί από οποιοδήποτε από τα δύο,
> τo routing σπάει.

> [!NOTE]
> Για TLS με Nginx χρειάζεται ξεχωριστό certbot/acme. Ο Caddy και ο Traefik
> το διαχειρίζονται αυτόματα.

---

## Checklist επαλήθευσης

Μετά την ανάπτυξη, έλεγξε:

- [ ] Η σελίδα φορτώνει (HTML + CSS + JS)
- [ ] Το login/setup λειτουργεί (`/api/auth/status` επιστρέφει 200)
- [ ] Τα VMs φορτώνουν (`/api/vms` επιστρέφει JSON)
- [ ] Η εξαγωγή CSV δουλεύει (ανοίγει το αρχείο)
- [ ] Τα cookies `session_token` έχουν `SameSite=Lax` και `HttpOnly` (ήδη ρυθμισμένο)

```bash
# Γρήγορος έλεγχος API από terminal:
curl -I https://infra.iosifidis.gr/api/auth/status
# ή για subpath:
curl -I https://iosifidis.gr/infra/api/auth/status
# Και τα δύο πρέπει να επιστρέφουν HTTP 200
```
