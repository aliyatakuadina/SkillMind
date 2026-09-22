# Create database skillmind on the local Postgres.
# Password is read from PGPASSWORD or a psql prompt. It is not stored here.
#   $env:PGPASSWORD = '<from server .env>'
#   powershell -File scripts/ops/create_skillmind_db.ps1

$ErrorActionPreference = 'Stop'
$pgHost = if ($env:PGHOST) { $env:PGHOST } else { '127.0.0.1' }
$pgPort = if ($env:PGPORT) { $env:PGPORT } else { '5440' }
$pgUser = if ($env:PGUSER) { $env:PGUSER } else { 'postgres' }
$sql = Join-Path $PSScriptRoot 'create_skillmind_db.sql'

& psql -h $pgHost -p $pgPort -U $pgUser -d postgres -v ON_ERROR_STOP=1 -f $sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Database skillmind is ready on ${pgHost}:${pgPort}"
