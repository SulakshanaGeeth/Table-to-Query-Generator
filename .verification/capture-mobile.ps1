$ErrorActionPreference = 'Stop'
$rowcraftTargets = Invoke-RestMethod 'http://127.0.0.1:9223/json/list'
$rowcraftTarget = $rowcraftTargets | Where-Object { $_.type -eq 'page' -and $_.url -eq 'file:///D:/Projects/New%20folder/index.html' } | Select-Object -First 1
if (-not $rowcraftTarget) { throw 'Isolated Rowcraft test tab was not found.' }
$rowcraftSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$rowcraftSocket.ConnectAsync([Uri]$rowcraftTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$script:rowcraftMessageId = 0
function Invoke-RowcraftCdp {
    param([string]$Method, [hashtable]$Parameters = @{})
    $script:rowcraftMessageId++
    $rowcraftJson = @{ id = $script:rowcraftMessageId; method = $Method; params = $Parameters } | ConvertTo-Json -Compress -Depth 20
    $rowcraftBytes = [Text.Encoding]::UTF8.GetBytes($rowcraftJson)
    $rowcraftSocket.SendAsync([ArraySegment[byte]]::new($rowcraftBytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    while ($true) {
        $rowcraftStream = [IO.MemoryStream]::new()
        do {
            $rowcraftBuffer = [byte[]]::new(65536)
            $rowcraftReceived = $rowcraftSocket.ReceiveAsync([ArraySegment[byte]]::new($rowcraftBuffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
            $rowcraftStream.Write($rowcraftBuffer, 0, $rowcraftReceived.Count)
        } while (-not $rowcraftReceived.EndOfMessage)
        $rowcraftResponse = [Text.Encoding]::UTF8.GetString($rowcraftStream.ToArray()) | ConvertFrom-Json
        $rowcraftStream.Dispose()
        if ($rowcraftResponse.id -eq $script:rowcraftMessageId) {
            if ($rowcraftResponse.error) { throw ($rowcraftResponse.error | ConvertTo-Json -Compress) }
            return $rowcraftResponse.result
        }
    }
}
try {
    Invoke-RowcraftCdp 'Emulation.setDeviceMetricsOverride' @{ width = 390; height = 1100; deviceScaleFactor = 1; mobile = $true } | Out-Null
    Invoke-RowcraftCdp 'Emulation.setTouchEmulationEnabled' @{ enabled = $true } | Out-Null
    $rowcraftMetrics = Invoke-RowcraftCdp 'Runtime.evaluate' @{ expression = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns}))))'; awaitPromise = $true; returnByValue = $true }
    $rowcraftMetrics.result.value | ConvertTo-Json -Compress
    if ($rowcraftMetrics.result.value.pageWidth -gt 390) { throw 'Mobile page overflows horizontally.' }
    $rowcraftImage = Invoke-RowcraftCdp 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true; fromSurface = $true }
    [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'mobile.png'), [Convert]::FromBase64String($rowcraftImage.data))
    Invoke-RowcraftCdp 'Runtime.evaluate' @{ expression = 'document.getElementById("load-example").click()' } | Out-Null
    Invoke-RowcraftCdp 'Emulation.setDeviceMetricsOverride' @{ width = 1440; height = 1100; deviceScaleFactor = 1; mobile = $false } | Out-Null
    Invoke-RowcraftCdp 'Runtime.evaluate' @{ expression = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'; awaitPromise = $true } | Out-Null
    $rowcraftExampleImage = Invoke-RowcraftCdp 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true; fromSurface = $true }
    [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'example.png'), [Convert]::FromBase64String($rowcraftExampleImage.data))
    'Captured mobile layout and populated desktop example.'
} finally {
    $rowcraftSocket.Dispose()
}
