<?php
declare(strict_types=1);

/**
 * Same-origin API proxy for Hostinger (totems / networks that block onrender.com).
 * Requests: https://globalimports.app/api/* → Render backend.
 */

const BACKEND_ORIGIN = 'https://global-backend-bdbx.onrender.com';

$queryParams = [];
$queryString = (string) ($_SERVER['QUERY_STRING'] ?? '');
if ($queryString !== '') {
    parse_str($queryString, $queryParams);
}

$path = isset($queryParams['__path']) ? (string) $queryParams['__path'] : '';
unset($queryParams['__path']);

if ($path === '') {
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $redirectUri = (string) ($_SERVER['REDIRECT_URL'] ?? '');

    foreach ([$requestUri, $redirectUri] as $uriCandidate) {
        if ($uriCandidate !== '' && preg_match('#^/api/?(.*)$#', $uriCandidate, $matches)) {
            $path = (string) ($matches[1] ?? '');
            break;
        }
    }
}

$path = ltrim($path, '/');
if ($path === 'index.php') {
    $path = '';
}

$queryString = http_build_query($queryParams);

$targetUrl = BACKEND_ORIGIN . '/api/' . $path;
if ($queryString !== '') {
    $targetUrl .= '?' . $queryString;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$rawBody = file_get_contents('php://input');

$forwardHeaders = [];
if (function_exists('getallheaders')) {
    foreach (getallheaders() as $name => $value) {
        $lower = strtolower((string) $name);
        if (in_array($lower, ['host', 'connection', 'content-length', 'accept-encoding'], true)) {
            continue;
        }
        $forwardHeaders[] = $name . ': ' . $value;
    }
}

$forwardHeaders[] = 'Host: global-backend-bdbx.onrender.com';
$forwardHeaders[] = 'X-Forwarded-Proto: https';
$forwardHeaders[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? 'globalimports.app');

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_CONNECTTIMEOUT => 30,
    CURLOPT_HTTPHEADER => $forwardHeaders,
]);

if ($rawBody !== false && $rawBody !== '' && !in_array($method, ['GET', 'HEAD'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
}

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'message' => 'No se pudo conectar con el servidor de Global Imports.',
    ]);
    exit;
}

$statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$responseHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);

http_response_code($statusCode > 0 ? $statusCode : 502);

foreach (preg_split("/\r\n|\n|\r/", $responseHeaders) as $headerLine) {
    if ($headerLine === '' || stripos($headerLine, 'HTTP/') === 0) {
        continue;
    }

    $colonPos = strpos($headerLine, ':');
    if ($colonPos === false) {
        continue;
    }

    $headerName = trim(substr($headerLine, 0, $colonPos));
    $headerValue = trim(substr($headerLine, $colonPos + 1));
    $lowerName = strtolower($headerName);

    if (in_array($lowerName, ['transfer-encoding', 'connection', 'content-encoding', 'content-length'], true)) {
        continue;
    }

    header($headerName . ': ' . $headerValue, $lowerName !== 'set-cookie');
}

echo $responseBody;
