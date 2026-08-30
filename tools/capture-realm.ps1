<#
    Record what the server tells the client about the realm.

        Run this from an ADMINISTRATOR PowerShell:
            .\tools\capture-realm.ps1 -Seconds 120

    The realm is generated on the server and streamed to the client tile by
    tile as you walk, which is why no file on disk holds it. This listens to
    that stream — passively, with pktmon, which ships with Windows. It does
    not attach to the game, inject anything into it, or send it a single byte:
    it reads packets off the loopback and the network adapter the way a
    tcpdump would.

    The capture lands in client-data/capture/, which is not published.

    A warning worth reading: a capture of a live session contains your session
    token as well as the map. Keep the files to yourself, and treat a capture
    the way you would treat a password manager export.
#>
[CmdletBinding()]
param(
    [int]$Seconds = 120,
    [int]$Port = 2050,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host ''
    Write-Host '  pktmon needs an administrator prompt. Right-click PowerShell,' -ForegroundColor Yellow
    Write-Host '  "Run as administrator", then run this again.' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

if (-not $OutDir) {
    $OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'client-data\capture'
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$etl = Join-Path $OutDir "realm-$stamp.etl"
$pcap = Join-Path $OutDir "realm-$stamp.pcapng"

Write-Host ''
Write-Host "  capturing TCP $Port for $Seconds seconds" -ForegroundColor Cyan
Write-Host "  walk somewhere you have not been. New ground is the point." -ForegroundColor Cyan
Write-Host ''

# Only the game's port, both directions, payload included. Nothing else on the
# machine is recorded.
& pktmon.exe filter remove | Out-Null
& pktmon.exe filter add RealmAtlas -t TCP -p $Port | Out-Null

# -p 0 keeps the whole packet rather than the first 128 bytes: the tile data is
# the payload, and a truncated packet is a useless one.
& pktmon.exe start --capture --pkt-size 0 --file-name $etl --file-size 512 | Out-Null

$spin = @('|','/','-','\')
for ($i = 0; $i -lt $Seconds; $i++) {
    Start-Sleep -Seconds 1
    $left = $Seconds - $i - 1
    Write-Host ("`r  {0}  {1,4}s left " -f $spin[$i % 4], $left) -NoNewline
}
Write-Host "`r  done              "

& pktmon.exe stop | Out-Null
& pktmon.exe filter remove | Out-Null

if (-not (Test-Path $etl)) {
    Write-Host '  pktmon wrote nothing. Was the game connected?' -ForegroundColor Yellow
    exit 1
}

Write-Host ("  {0}  ({1:N1} MB)" -f (Split-Path -Leaf $etl), ((Get-Item $etl).Length / 1MB))

# pcapng if this build of Windows can, and the raw etl either way.
try {
    & pktmon.exe etl2pcap $etl --out $pcap | Out-Null
    if (Test-Path $pcap) {
        Write-Host ("  {0}  ({1:N1} MB)" -f (Split-Path -Leaf $pcap), ((Get-Item $pcap).Length / 1MB))
    }
} catch {
    Write-Host '  this build of pktmon cannot make a pcapng; the etl is there.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "  -> $OutDir" -ForegroundColor Green
Write-Host '  Then: node tools/read-capture.js' -ForegroundColor Green
Write-Host ''
