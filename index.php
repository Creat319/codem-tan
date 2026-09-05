<?php
declare(strict_types=1);

session_name('cm3rdforum');
session_start();

require __DIR__ . '/inc/api.php';

$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($requestUri, PHP_URL_PATH) ?: '/';

// API proxy endpoint
if (preg_match('#^/api(/|$)#', $path)) {
    handle_api();
    exit;
}

// Front-end shell (HTML / CSS / JS 分文件维护)
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/templates/shell.html');
