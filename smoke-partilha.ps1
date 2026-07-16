# smoke-partilha.ps1
$ErrorActionPreference = "Stop"

$base = "http://localhost:10000"
$shareId = "SHR-TESTE-001"
$contacto = "+351911111111"

function Post-Json($url, $obj, $headers=@{}) {
  $body = $obj | ConvertTo-Json -Compress -Depth 10
  return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType "application/json" -Body $body
}

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "SMOKE PARTILHA (FULL FLOW)" -ForegroundColor Cyan
Write-Host "Base: $base" -ForegroundColor Cyan
Write-Host "ShareId: $shareId" -ForegroundColor Cyan
Write-Host "Contacto: $contacto" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# 0) probes
Write-Host "0) probes..." -ForegroundColor Yellow
Invoke-RestMethod -Method Get -Uri "$base/api/__partilha_ok" | Out-Host
Invoke-RestMethod -Method Get -Uri "$base/api/partilha/ping" | Out-Host
Write-Host ""

# 1) test-create
Write-Host "1) test-create..." -ForegroundColor Yellow
$resp = Post-Json "$base/api/partilha/invite/test-create" @{ shareId=$shareId; contacto=$contacto }
if($resp.ok -ne $true) { throw "test-create falhou" }

$invite = $resp.invite
$otp = $resp.otp
Write-Host ("inviteId: " + $resp.inviteId) -ForegroundColor Green
Write-Host ("otp: " + $otp) -ForegroundColor Green
Write-Host ""

# 2) verify
Write-Host "2) verify..." -ForegroundColor Yellow
$verify = Post-Json "$base/api/partilha/invite/verify" @{ invite=$invite; otp=$otp }
if($verify.ok -ne $true) { throw "verify falhou" }

$sessionToken = $verify.sessionToken
Write-Host ("sessionToken len: " + $sessionToken.Length) -ForegroundColor Green
Write-Host ""

# 3) location/update
Write-Host "3) location/update..." -ForegroundColor Yellow

# PT locale: manda como string (evita virgula)
$locBody = @{
  lat = "38.7169"
  lng = "-9.1390"
  accuracy = 20
}

$headers = @{ Authorization = ("Bearer " + $sessionToken) }

$loc = Post-Json "$base/api/partilha/location/update" $locBody $headers
if($loc.ok -ne $true) { throw "location/update falhou" }
$loc | Out-Host
Write-Host ""

# 4) calc
Write-Host "4) calc..." -ForegroundColor Yellow
$calcBody = @{
  shareId = $shareId
  categoria = "economica"
  userOrderContacts = @($contacto)
  destino = @{ address="Lisboa"; lat="38.7223"; lng="-9.1393" }
  suggest = $true
}

try {
  $calc = Post-Json "$base/api/partilha/calc" $calcBody
  $calc | Out-Host

  if($calc.ok -ne $true) { throw "calc nao devolveu ok:true" }

  Write-Host ""
  Write-Host ("OK. totalFinal: " + $calc.totalFinal + " EUR") -ForegroundColor Green
  Write-Host "participants:" -ForegroundColor Green
  $calc.participants | Format-Table contacto, distanciaKm, amountDue -AutoSize | Out-Host

} catch {
  Write-Host ""
  Write-Host "CALC FALHOU:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  throw
}

Write-Host ""

# 5) debug/list
Write-Host "5) debug/list..." -ForegroundColor Yellow
$debug = Invoke-RestMethod -Method Get -Uri "$base/api/partilha/invite/debug/list?shareId=$shareId"
$debug | Out-Host

$found = $null
if($debug.docs) {
  foreach($d in $debug.docs){
    if($d.contacto -eq $contacto){
      $found = $d
      break
    }
  }
}

Write-Host ""
if($null -ne $found){
  Write-Host "DOC DO CONTACTO:" -ForegroundColor Green
  $found | ConvertTo-Json -Depth 8 | Out-Host
  Write-Host ""
  Write-Host "lat/lng/locatedAt devem estar preenchidos no doc acima." -ForegroundColor Green
} else {
  Write-Host ("Nao encontrei doc com contacto exato " + $contacto + ". Pode estar noutra variante. Veja a lista acima.") -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "SMOKE FINALIZADO" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""
