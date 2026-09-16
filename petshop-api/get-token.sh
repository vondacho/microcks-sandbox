#!/usr/bin/env bash
# Fetches an access token from the local Keycloak dev realm.
#
#   ./get-token.sh                 # client credentials, both scopes
#   ./get-token.sh pets:read       # client credentials, read only
#   ./get-token.sh pets:read alice # alice's password grant, read only
#
# Typical use:
#   TOKEN=$(./get-token.sh) && curl -H "Authorization: Bearer $TOKEN" localhost:8080/api/pets
set -euo pipefail

ISSUER="${PETSHOP_ISSUER_URI:-http://localhost:8081/realms/petshop}"
SCOPE="${1:-pets:read pets:write}"
USERNAME="${2:-}"

if [[ -n "$USERNAME" ]]; then
  RESPONSE=$(curl -sS -X POST "$ISSUER/protocol/openid-connect/token" \
    -d grant_type=password \
    -d client_id=petshop-service \
    -d client_secret=petshop-service-secret \
    -d "username=$USERNAME" \
    -d "password=$USERNAME" \
    --data-urlencode "scope=$SCOPE")
else
  RESPONSE=$(curl -sS -X POST "$ISSUER/protocol/openid-connect/token" \
    -d grant_type=client_credentials \
    -d client_id=petshop-service \
    -d client_secret=petshop-service-secret \
    --data-urlencode "scope=$SCOPE")
fi

TOKEN=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' 2>/dev/null) || {
  echo "Token request failed:" >&2
  printf '%s\n' "$RESPONSE" >&2
  exit 1
}
printf '%s\n' "$TOKEN"
