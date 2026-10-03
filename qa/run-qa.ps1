$ErrorActionPreference = "Stop"
Write-Host "Starting PRIVault full QA suite in Docker..."
docker compose -f qa/docker-compose.qa.yml up --build --abort-on-container-exit --exit-code-from qa
$code = $LASTEXITCODE
docker compose -f qa/docker-compose.qa.yml down -v
exit $code
