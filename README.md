# CoedmTan · 第三方编程猫社区

一个现代化、简洁的第三方编程猫社区论坛前端。

- 默认 **深色模式**，无亮色模式切换
- 使用 `/img/icon.png` 作为站点图标
- 进入后先登录，使用编程猫社区账号（手机号 / 用户名 / 邮箱 + 密码）
- 登录后展示板块与帖子列表
- 帖子路由：`/tie/帖子ID`
- 可发布回帖、评论回帖、回复评论
- 所有敏感请求通过 PHP 后端代理，Cookie 保存在服务端 session 中

## 文件结构

```
.
├── index.php              # 入口 + API 路由
├── inc/api.php            # 编程猫 API 代理
├── templates/shell.html   # HTML 页面
├── assets/css/style.css   # 样式
├── assets/js/app.js       # 前端逻辑
├── img/icon.png           # 网站图标
└── .htaccess              # 前端路由重写
```

## 部署

1. 将全部文件上传到站点根目录（如 FTP 的 `wwwroot`）。
2. 服务器需支持 PHP 8+ 且开启 `curl` 扩展。
3. 由于使用了 `/tie/帖子ID` 这类前端路由，Apache 需要启用 `mod_rewrite`
   （通常虚拟主机默认已开启，`.htaccess` 已包含规则）。
4. 如果部署在子目录，请相应调整 `.htaccess` 与页面里的绝对路径 `/assets/...`。

## 说明

- 本项目为第三方社区，不保存用户密码；账号信息与发帖均通过编程猫开放 API 操作。
- 帖子正文/回帖/评论为官方接口返回的 HTML，前端直接渲染展示。
