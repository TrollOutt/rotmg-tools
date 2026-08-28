<#
    Creates a Desktop shortcut that opens the standalone build in "app mode":
    a plain window with no address bar and no tabs, which is as close to a
    native application as a web page gets without installing anything.

        powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1

    Run tools/build-standalone.js first. Delete the shortcut from the Desktop
    to undo; nothing else is written outside this repository.

    Without Chrome or Edge, the shortcut points at the HTML file itself, so it
    opens in whatever browser handles .html — a normal tab, same application.
#>
param(
    [string] $Name = 'RotMG Enchant Calculator'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$page = Join-Path $repo 'docs\RotMG-Enchant-Calculator.html'
$icon = Join-Path $repo 'data\appicon.ico'

if (-not (Test-Path $page)) {
    Write-Error "Not built yet: $page`nRun:  node tools\build-standalone.js"
}

$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

$link = Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"
if (Test-Path $link) { Write-Host "Replacing the existing shortcut at $link" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)

if ($browser) {
    $shortcut.TargetPath = $browser
    $shortcut.Arguments  = '--app="file:///' + $page.Replace('\', '/') + '"'
    $mode = "app window via $(Split-Path $browser -Leaf)"
} else {
    # No Chromium browser found: let the shell open the page with the default
    # handler. Same application, just inside a normal browser tab.
    $shortcut.TargetPath = $page
    $mode = 'default browser tab'
}

$shortcut.IconLocation     = $icon
$shortcut.WorkingDirectory = Split-Path $page
$shortcut.Description      = 'RotMG Enchant Calculator - offline single-file app'
$shortcut.Save()

Write-Host "Shortcut created: $link"
Write-Host "Opens as        : $mode"
Write-Host "Points at       : $page"
