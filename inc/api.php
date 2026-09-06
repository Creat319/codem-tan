<?php
/**
 * Codemao community third-party forum - backend proxy.
 * All sensitive calls go through this PHP server so cookies are kept on the server side.
 */

const CMAO_BASE = 'https://api.codemao.cn';
const CMAO_PID  = '65edCTyg';

/* ------------------------------------------------------------------ helpers */

function api_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function cm_cookies(): array
{
    if (!isset($_SESSION['cm_cookies']) || !is_array($_SESSION['cm_cookies'])) {
        $_SESSION['cm_cookies'] = [];
    }
    return $_SESSION['cm_cookies'];
}

function cm_cookie_header(): string
{
    $parts = [];
    foreach (cm_cookies() as $name => $value) {
        $parts[] = $name . '=' . $value;
    }
    return implode('; ', $parts);
}

function cm_store_set_cookie(string $headerLine): void
{
    $headerLine = trim($headerLine);
    if (stripos($headerLine, 'set-cookie:') !== 0) {
        return;
    }
    $pair = trim(substr($headerLine, 11));
    $semi = strpos($pair, ';');
    if ($semi !== false) {
        $pair = substr($pair, 0, $semi);
    }
    if ($pair === '' || strpos($pair, '=') === false) {
        return;
    }
    [$name, $value] = explode('=', $pair, 2);
    $name = trim($name);
    $value = trim($value);
    if ($name !== '') {
        $_SESSION['cm_cookies'][$name] = $value;
    }
}

/**
 * Perform a request toward the official Codemao API.
 *
 * @return array{status:int, body:mixed, raw:string}
 */
function cm_request(string $method, string $path, ?array $payload = null, array $extraHeaders = []): array
{
    $url = CMAO_BASE . $path;
    $ch = curl_init($url);

    $headers = [
        'Accept: application/json',
        'User-Agent: Mozilla/5.0 (compatible; ThirdPartyCodemaoForum/1.0)',
    ];

    $cookieHeader = cm_cookie_header();
    if ($cookieHeader !== '') {
        $headers[] = 'Cookie: ' . $cookieHeader;
    }

    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    }

    foreach ($extraHeaders as $h) {
        $headers[] = $h;
    }

    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_HEADERFUNCTION => static function ($curl, $headerLine) {
            cm_store_set_cookie($headerLine);
            return strlen($headerLine);
        },
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false || $body === '') {
        return ['status' => $status ?: 502, 'body' => ['error' => $error ?: 'empty response'], 'raw' => ''];
    }

    $decoded = json_decode($body, true);
    if (is_array($decoded)) {
        return ['status' => $status, 'body' => $decoded, 'raw' => $body];
    }

    return ['status' => $status, 'body' => $body, 'raw' => $body];
}

function cm_logged_in(): bool
{
    return !empty($_SESSION['cm_user']);
}

function cm_require_login(): void
{
    if (!cm_logged_in()) {
        api_json(['ok' => false, 'error' => '请先登录'], 401);
    }
}

function cm_looks_like_user($candidate): bool
{
    return is_array($candidate)
        && (isset($candidate['id']) || isset($candidate['nickname']) || isset($candidate['avatar_url']) || isset($candidate['avatar']));
}

function cm_remember_user(array $loginData): void
{
    $user = null;
    if (isset($loginData['user_info']) && is_array($loginData['user_info'])) {
        $user = $loginData['user_info'];
    } elseif (isset($loginData['data']['user_info']) && is_array($loginData['data']['user_info'])) {
        $user = $loginData['data']['user_info'];
    } elseif (isset($loginData['user']) && is_array($loginData['user'])) {
        $user = $loginData['user'];
    }

    // fallback: fill from /api/user/info if available
    if (!$user) {
        $res = cm_request('GET', '/api/user/info');
        $data = $res['body'];
        if (is_array($data)) {
            $candidate = null;
            if (isset($data['data']) && is_array($data['data']) && cm_looks_like_user($data['data'])) {
                $candidate = $data['data'];
            } elseif (cm_looks_like_user($data)) {
                $candidate = $data;
            }
            if ($candidate) {
                $user = $candidate;
            }
        }
    }

    if (!$user) {
        $user = ['id' => 0, 'nickname' => '编程猫用户', 'avatar_url' => ''];
    }

    $_SESSION['cm_user'] = $user;
    $_SESSION['cm_auth'] = $loginData['auth'] ?? ($loginData['data']['auth'] ?? null);
}

/* ------------------------------------------------------------------ api routes */

function handle_api(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = preg_replace('#^/api/?#', '', $path);
    $path = rtrim($path, '/');
    $parts = $path === '' ? [] : explode('/', $path);
    $route = $parts[0] ?? '';
    $query = $_GET;

    switch ($route) {
        case 'session':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $user = $_SESSION['cm_user'] ?? null;
            if ($user) {
                api_json(['ok' => true, 'logged_in' => true, 'user' => $user]);
            }
            api_json(['ok' => true, 'logged_in' => false, 'user' => null]);
            break;

        case 'login':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $input = api_body();
            $identity = trim((string)($input['identity'] ?? ''));
            $password = (string)($input['password'] ?? '');
            if ($identity === '' || $password === '') {
                api_json(['ok' => false, 'error' => '账号与密码不能为空'], 400);
            }

            $res = cm_request('POST', '/tiger/v3/web/accounts/login', [
                'pid'      => CMAO_PID,
                'identity' => $identity,
                'password' => $password,
            ]);

            if ($res['status'] >= 200 && $res['status'] < 300 && is_array($res['body'])) {
                cm_remember_user($res['body']);
                api_json([
                    'ok'     => true,
                    'logged_in' => true,
                    'user'   => $_SESSION['cm_user'] ?? null,
                    'auth'   => $_SESSION['cm_auth'] ?? null,
                ]);
            }

            $error = '登录失败';
            if (is_array($res['body'])) {
                $error = (string)($res['body']['error_message'] ?? $res['body']['message'] ?? $error);
            }
            api_json(['ok' => false, 'error' => $error], $res['status'] >= 400 ? $res['status'] : 401);
            break;

        case 'logout':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $_SESSION['cm_user'] = null;
            $_SESSION['cm_auth'] = null;
            $_SESSION['cm_cookies'] = [];
            api_json(['ok' => true]);
            break;

        case 'backgrounds':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $dir = dirname(__DIR__) . '/img/bj';
            $items = [];
            if (is_dir($dir)) {
                $files = scandir($dir);
                foreach ($files as $file) {
                    if ($file === '.' || $file === '..') continue;
                    if (!preg_match('/\.(jpg|jpeg|png|gif|webp)$/i', $file)) continue;
                    $items[] = '/img/bj/' . rawurlencode($file);
                }
            }
            sort($items);
            api_json(['items' => $items, 'ok' => true], 200);
            break;

        case 'boards':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $res = cm_request('GET', '/web/forums/boards/simples/all');
            $body = is_array($res['body']) ? $res['body'] : ['items' => []];
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'search':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $title = trim((string)($query['title'] ?? ''));
            $limit = max(5, min(30, (int)($query['limit'] ?? 10)));
            $offset = max(0, (int)($query['offset'] ?? 0));
            $page = intdiv($offset, $limit) + 1;
            if ($title === '') {
                api_json(['ok' => false, 'error' => '请输入搜索关键词'], 400);
            }
            $path = '/web/forums/posts/search?title=' . rawurlencode($title) . '&limit=' . $limit . '&page=' . $page;
            $res = cm_request('GET', $path);
            $body = is_array($res['body']) ? $res['body'] : ['items' => []];
            $body['offset'] = $offset;
            $body['limit'] = $limit;
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'posts':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $boardRaw = (string)($query['board_id'] ?? '2');
            $limit = max(5, min(30, (int)($query['limit'] ?? 10)));
            $offset = max(0, (int)($query['offset'] ?? 0));

            // “全部”分类：官方没有直接的全站最新接口，使用全站热门 ID 再批量取详情
            if ($boardRaw === '' || $boardRaw === 'all' || $boardRaw === '-1' || $boardRaw === '0') {
                $hots = cm_request('GET', '/web/forums/posts/hots/all');
                $hotBody = is_array($hots['body']) ? $hots['body'] : [];
                $allIds = isset($hotBody['items']) && is_array($hotBody['items']) ? $hotBody['items'] : [];
                $total = count($allIds);
                $pageIds = array_slice($allIds, $offset, $limit);
                if (!$pageIds) {
                    api_json([
                        'items'   => [],
                        'offset'  => $offset,
                        'limit'   => $limit,
                        'total'   => $total,
                        'counted' => true,
                        'ok'      => true,
                    ], 200);
                }
                $res = cm_request('GET', '/web/forums/posts/all?ids=' . implode(',', $pageIds));
                $body = is_array($res['body']) ? $res['body'] : ['items' => []];
                $body['offset'] = $offset;
                $body['limit'] = $limit;
                $body['total'] = $total;
                $body['counted'] = true;
                $body['ok'] = true;
                api_json($body, $res['status']);
            }

            $boardId = rawurlencode($boardRaw);
            $path = '/web/forums/boards/' . $boardId . '/posts?limit=' . $limit . '&offset=' . $offset;
            $res = cm_request('GET', $path);
            $body = is_array($res['body']) ? $res['body'] : ['items' => []];
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'post':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $postId = rawurlencode((string)($query['id'] ?? ''));
            if ($postId === '') {
                api_json(['ok' => false, 'error' => '缺少帖子 id'], 400);
            }
            $res = cm_request('GET', '/web/forums/posts/' . $postId . '/details');
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'replies':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $postId = rawurlencode((string)($query['post_id'] ?? ''));
            if ($postId === '') {
                api_json(['ok' => false, 'error' => '缺少帖子 id'], 400);
            }
            $limit = max(1, min(50, (int)($query['limit'] ?? 20)));
            $offset = max(0, (int)($query['offset'] ?? 0));
            $res = cm_request('GET', '/web/forums/posts/' . $postId . '/replies?limit=' . $limit . '&offset=' . $offset);
            $body = is_array($res['body']) ? $res['body'] : ['items' => []];
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'comments':
            if ($method !== 'GET') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            $replyId = rawurlencode((string)($query['reply_id'] ?? ''));
            if ($replyId === '') {
                api_json(['ok' => false, 'error' => '缺少回帖 id'], 400);
            }
            $limit = max(1, min(100, (int)($query['limit'] ?? 100)));
            $offset = max(0, (int)($query['offset'] ?? 0));
            $res = cm_request('GET', '/web/forums/replies/' . $replyId . '/comments?limit=' . $limit . '&offset=' . $offset);
            $body = is_array($res['body']) ? $res['body'] : ['items' => []];
            $body['ok'] = true;
            api_json($body, $res['status']);
            break;

        case 'publish':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $boardId = rawurlencode(trim((string)($input['board_id'] ?? '')));
            $title = trim((string)($input['title'] ?? ''));
            $content = trim((string)($input['content'] ?? ''));
            if ($boardId === '' || $boardId === 'all') {
                api_json(['ok' => false, 'error' => '请选择要发布的板块'], 400);
            }
            if ($title === '') {
                api_json(['ok' => false, 'error' => '标题不能为空'], 400);
            }
            if ($content === '') {
                api_json(['ok' => false, 'error' => '内容不能为空'], 400);
            }
            $res = cm_request('POST', '/web/forums/boards/' . $boardId . '/posts', [
                'title'   => $title,
                'content' => $content,
            ]);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? $body['message'] ?? '发帖失败，可能账号未绑定手机号');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        case 'delete_post':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $postId = rawurlencode(trim((string)($input['post_id'] ?? '')));
            if ($postId === '') {
                api_json(['ok' => false, 'error' => '缺少帖子 id'], 400);
            }
            $res = cm_request('DELETE', '/web/forums/posts/' . $postId);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? $body['message'] ?? '删除帖子失败');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        case 'delete_reply':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $replyId = rawurlencode(trim((string)($input['reply_id'] ?? '')));
            if ($replyId === '') {
                api_json(['ok' => false, 'error' => '缺少回帖 id'], 400);
            }
            $res = cm_request('DELETE', '/web/forums/replies/' . $replyId);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? $body['message'] ?? '删除回帖失败');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        case 'delete_comment':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $commentId = rawurlencode(trim((string)($input['comment_id'] ?? '')));
            if ($commentId === '') {
                api_json(['ok' => false, 'error' => '缺少评论 id'], 400);
            }
            $res = cm_request('DELETE', '/web/forums/comments/' . $commentId);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? $body['message'] ?? '删除评论失败');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        case 'reply':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $postId = rawurlencode((string)($input['post_id'] ?? ''));
            $content = trim((string)($input['content'] ?? ''));
            if ($postId === '' || $content === '') {
                api_json(['ok' => false, 'error' => '内容不能为空'], 400);
            }
            $res = cm_request('POST', '/web/forums/posts/' . $postId . '/replies', ['content' => $content]);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? '回帖失败');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        case 'comment':
            if ($method !== 'POST') {
                api_json(['ok' => false, 'error' => 'method not allowed'], 405);
            }
            cm_require_login();
            $input = api_body();
            $replyId = rawurlencode((string)($input['reply_id'] ?? ''));
            $content = trim((string)($input['content'] ?? ''));
            $parentId = isset($input['parent_id']) ? (int)$input['parent_id'] : 0;
            if ($replyId === '' || $content === '') {
                api_json(['ok' => false, 'error' => '内容不能为空'], 400);
            }
            $payload = ['content' => $content];
            if ($parentId > 0) {
                $payload['parent_id'] = $parentId;
            }
            $res = cm_request('POST', '/web/forums/replies/' . $replyId . '/comments', $payload);
            $body = is_array($res['body']) ? $res['body'] : [];
            $body['ok'] = $res['status'] >= 200 && $res['status'] < 300;
            if (!$body['ok']) {
                $body['error'] = (string)($body['error_message'] ?? '回复失败');
            }
            api_json($body, $res['status'] >= 400 ? $res['status'] : 200);
            break;

        default:
            api_json(['ok' => false, 'error' => 'not found'], 404);
    }
}
