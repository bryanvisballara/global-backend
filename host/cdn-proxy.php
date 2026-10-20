<?php
declare(strict_types=1);

const BACKEND_ORIGIN = 'https://global-backend-bdbx.onrender.com';

function isAllowedAssetPath(string $path): bool
{
    $normalizedPath = '/' . ltrim($path, '/');

    $decodedPath = rawurldecode($normalizedPath);

    if (preg_match('#^/uploads/.+\.(png|jpe?g|webp|gif|mp4|webm|mov)$#i', $decodedPath)) {
        return true;
    }

    return (bool) preg_match(
        '#^/(sr5|1794|limited|platinum|capstone|trd)[^/]+/.+\.(png|jpe?g|webp|gif|mp4|webm|mov)$#i',
        $decodedPath
    );
}

function buildBackendAssetUrl(string $relativePath): string
{
    $segments = array_values(array_filter(explode('/', trim($relativePath, '/')), static function ($segment) {
        return $segment !== '' && $segment !== '.' && $segment !== '..';
    }));

    $segments = array_map(static function ($segment) {
        $decoded = rawurldecode($segment);
        if (strpos($decoded, '%') !== false) {
            $decoded = rawurldecode($decoded);
        }

        return rawurlencode($decoded);
    }, $segments);

    return BACKEND_ORIGIN . '/' . implode('/', $segments);
}

$relativePath = '';

if (!empty($_GET['__path'])) {
    $relativePath = (string) $_GET['__path'];
} else {
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if (preg_match('#^/cdn-proxy/?(.*)$#', $requestUri, $matches)) {
        $relativePath = (string) ($matches[1] ?? '');
    }
}

$relativePath = trim($relativePath, '/');

if ($relativePath === '' || !isAllowedAssetPath('/' . $relativePath)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden';
    exit;
}

$targetUrl = buildBackendAssetUrl($relativePath);

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 180,
    CURLOPT_CONNECTTIMEOUT => 45,
    CURLOPT_HTTPHEADER => [
        'Host: global-backend-bdbx.onrender.com',
        'Accept: image/*,video/*,*/*;q=0.8',
    ],
]);

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Bad gateway';
    exit;
}

$statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

$responseBody = substr($response, $headerSize);

http_response_code($statusCode > 0 ? $statusCode : 502);

if ($contentType !== '') {
    header('Content-Type: ' . $contentType);
}

header('Cache-Control: public, max-age=86400');

echo $responseBody;
