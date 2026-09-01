<#
    Record what the server tells the client about the realm.

        Run this from an ADMINISTRATOR PowerShell:
            .\tools\capture-realm.ps1

        Or for a fixed-duration capture:
            .\tools\capture-realm.ps1 -Seconds 120

    The realm is generated on the server and streamed to the client tile by
    tile as you walk, which is why no file on disk holds it. This listens to
    that stream - passively, with pktmon, which ships with Windows. It does
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
    [int]$Seconds = 0,
    [int]$Port = 2050,
    [string]$OutDir,
    # Two ways of trying to make pktmon drop fewer packets. Neither is on by
    # default, because the plain capture below is the one known to produce a
    # file on this machine and a capture that writes nothing is worse than a
    # capture with holes in it. Try them one at a time.
    #
    # -NicsOnly captures at the network cards instead of at every component
    # in the stack, which cuts the logged events several-fold; but if the
    # game's traffic does not cross a physical card it selects nothing.
    #
    # -InMemory holds the log in memory and writes it out at the end instead
    # of writing while the game streams.
    [switch]$NicsOnly,
    [switch]$InMemory
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
$manual = $Seconds -le 0

Write-Host ''
if ($manual) {
    Write-Host "  manual capture of TCP $Port" -ForegroundColor Cyan
    Write-Host '  Press Enter to START recording.' -ForegroundColor Cyan
    Write-Host ''
    Read-Host | Out-Null
} else {
    Write-Host "  capturing TCP $Port for $Seconds seconds" -ForegroundColor Cyan
}
Write-Host "  IMPORTANT: start a NEW realm connection after capture starts (leave and re-enter, or relaunch)." -ForegroundColor Yellow
Write-Host "  Then walk through new ground. RC4 starts at connection time, not at packet time." -ForegroundColor Cyan
Write-Host ''

# Only the game's port, both directions, payload included. Nothing else on the
# machine is recorded.
& pktmon.exe filter remove | Out-Null
& pktmon.exe filter add RealmAtlas -t TCP -p $Port | Out-Null

# Everything here is about not dropping a single byte, because the stream is
# encrypted with a stream cipher: its state depends on every byte before it,
# so one lost byte spoils everything after it until the reader finds its feet
# again. A capture that loses five percent of the bytes loses far more than
# five percent of the map.
#
#   --pkt-size 0   the whole packet, not the first 128 bytes. The tile data
#                  is the payload; a truncated packet is a useless one.
#
# What is NOT here is anything clever about buffering. --log-mode memory
# reads well in the help and writes no file at all on this machine, and
# --comp nics selects nothing when the traffic does not cross a physical
# card. Both are switches now, off by default: a capture with holes in it
# is worth a great deal more than a capture that does not happen.
$startArgs = @('start', '--capture', '--pkt-size', '0',
               '--file-name', $etl, '--file-size', '512')
if ($NicsOnly) { $startArgs += @('--comp', 'nics') }
if ($InMemory) { $startArgs += @('--log-mode', 'memory') }

Write-Host ('  pktmon ' + ($startArgs -join ' ')) -ForegroundColor DarkGray
$startSaid = & pktmon.exe @startArgs 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  pktmon would not start:' -ForegroundColor Red
    Write-Host ('    ' + $startSaid.Trim())
    & pktmon.exe filter remove | Out-Null
    exit 1
}

# Let the capture get on its feet before the game is asked to reconnect.
# Every recording so far has lost a couple of kilobytes right at the start,
# which is pktmon still starting up while the first packets go past.
Start-Sleep -Seconds 2

if ($manual) {
    Write-Host '  recording. Press Enter to STOP.' -ForegroundColor Green
    Write-Host ''
    Read-Host | Out-Null
} else {
    $spin = @('|','/','-','\')
    for ($i = 0; $i -lt $Seconds; $i++) {
        Start-Sleep -Seconds 1
        $left = $Seconds - $i - 1
        Write-Host ("`r  {0}  {1,4}s left " -f $spin[$i % 4], $left) -NoNewline
    }
}
Write-Host "`r  done              "

& pktmon.exe stop | Out-Null
& pktmon.exe filter remove | Out-Null

if (-not (Test-Path $etl)) {
    Write-Host '  pktmon wrote nothing where it was asked to.' -ForegroundColor Yellow
    # A mode that ignores --file-name would leave the log under its own name
    # somewhere else, and that is worth knowing before blaming the game.
    $strays = @(Get-ChildItem -Path (Get-Location), $env:TEMP, $OutDir -Filter '*.etl' `
        -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-10) })
    if ($strays.Count) {
        Write-Host '  but it did write these in the last ten minutes:' -ForegroundColor Yellow
        foreach ($f in $strays) { Write-Host ('    ' + $f.FullName + '  ' + [int]($f.Length / 1KB) + ' KB') }
    }
    if ($NicsOnly -or $InMemory) {
        Write-Host '  Run it again with no switches at all - that is the form known to work.' -ForegroundColor Yellow
    } else {
        Write-Host '  Was the game connected, and was a NEW connection made after the start?' -ForegroundColor Yellow
    }
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

# Say straight away whether anything was dropped. A capture with holes in it
# cannot be salvaged later - the reader can tell you the stream is short, but
# nothing can put back bytes that were never written down - so it is worth
# knowing now, while the game is still open and the walk can be redone.
if (Test-Path $pcap) {
    Write-Host ''
    Write-Host '  checking the capture for holes...' -ForegroundColor Cyan
    $report = & node (Join-Path $PSScriptRoot 'read-capture.js') 2>&1 | Out-String
    $holes = [regex]::Matches($report, '([\d.]+)% never captured')
    if ($holes.Count -eq 0) {
        Write-Host '  no gaps: every byte of every stream was recorded.' -ForegroundColor Green
    } else {
        $worst = ($holes | ForEach-Object { [double]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum
        Write-Host ('  {0:N1}% of a stream was never captured - this recording has holes.' -f $worst) -ForegroundColor Red
        Write-Host '  The cipher cannot skip a gap, so far more than that is lost.' -ForegroundColor Yellow
        Write-Host '  Close other network-heavy programs and record it again.' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host "  -> $OutDir" -ForegroundColor Green
Write-Host '  Then: node tools/read-capture.js' -ForegroundColor Green
Write-Host ''
