# MCP(Model Context Protocol)配置

DeerFlow 支持可配置的 MCP 服务器与技能(skills)来扩展能力,它们通过项目根目录下专用的 `extensions_config.json` 文件加载。

## 安装

1. 将 `extensions_config.example.json` 复制为项目根目录下的 `extensions_config.json`。
   ```bash
   # 复制示例配置
   cp extensions_config.example.json extensions_config.json
   ```
   
2. 通过设置 `"enabled": true` 开启所需的 MCP 服务器或技能。
3. 根据需要配置每个服务器的命令、参数与环境变量。
4. 重启应用以加载并注册 MCP 工具。

## OAuth 支持(HTTP/SSE 类型的 MCP 服务器)

对于 `http` 与 `sse` 类型的 MCP 服务器,DeerFlow 支持 OAuth token 获取与自动刷新。

- 支持的授权类型：`client_credentials`、`refresh_token`
- 在 `extensions_config.json` 中为每个服务器配置 `oauth` 字段
- 机密信息应通过环境变量提供(例如：`$MCP_OAUTH_CLIENT_SECRET`)

示例：

```json
{
   "mcpServers": {
      "secure-http-server": {
         "enabled": true,
         "type": "http",
         "url": "https://api.example.com/mcp",
         "oauth": {
            "enabled": true,
            "token_url": "https://auth.example.com/oauth/token",
            "grant_type": "client_credentials",
            "client_id": "$MCP_OAUTH_CLIENT_ID",
            "client_secret": "$MCP_OAUTH_CLIENT_SECRET",
            "scope": "mcp.read",
            "refresh_skew_seconds": 60
         }
      }
   }
}
```

## 工作原理

MCP 服务器暴露的工具会在运行时被自动发现,并集成进 DeerFlow 的 agent 系统。一旦启用,这些工具无需改动代码即可被 agent 使用。

## 能力示例

MCP 服务器可以提供对以下能力的访问：

- **文件系统**
- **数据库**(例如 PostgreSQL)
- **外部 API**(例如 GitHub、Brave Search)
- **浏览器自动化**(例如 Puppeteer)
- **自定义 MCP 服务器实现**

## 了解更多

关于 Model Context Protocol 的详细文档,请访问：  
https://modelcontextprotocol.io
