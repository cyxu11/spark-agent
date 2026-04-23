# 记忆系统改进

本文档跟踪记忆注入行为与路线图状态。

## 状态(截至 2026-03-10)

已在 `main` 分支实现：
- 在 `format_memory_for_injection` 中通过 `tiktoken` 进行精确的 token 计数
- 事实(facts)会被注入到 prompt 的记忆上下文中
- 事实按 confidence 降序排列
- 注入受 `max_injection_tokens` 预算约束

规划中 / 尚未合入：
- 基于 TF-IDF 相似度的事实检索
- 支持 `current_context` 入参以做上下文感知打分
- 可配置的相似度/置信度权重(`similarity_weight`、`confidence_weight`)
- 在每次模型调用前,通过 middleware/runtime 接入上下文感知的召回流程

## 当前行为

当前函数：

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

当前注入格式：
- `User Context` 区块来自 `user.*.summary`
- `History` 区块来自 `history.*.summary`
- `Facts` 区块来自 `facts[]`,按 confidence 排序追加,直到触达 token 预算

Token 计数：
- 可用时使用 `tiktoken`(`cl100k_base`)
- 若 tokenizer 导入失败,回退到 `len(text) // 4`

## 已知的文档差距

本文档的早期版本将 TF-IDF / 上下文感知检索描述得像是已经交付,但这对 `main` 分支并不准确,也造成了混淆。

Issue 引用：`#1059`

## 路线图(规划中)

规划中的打分策略：

```text
final_score = (similarity * 0.6) + (confidence * 0.4)
```

规划中的集成形态：
1. 从过滤后的 user 与最终 assistant 轮次中抽取最近的对话上下文
2. 计算每条事实与当前上下文之间的 TF-IDF 余弦相似度
3. 按加权得分排序,并在 token 预算内注入
4. 若上下文不可用,则回退到仅按 confidence 排序

## 验证

当前的回归覆盖包含：
- 事实是否出现在注入输出中
- confidence 排序
- token 预算受限场景下的事实纳入

测试：
- `backend/tests/test_memory_prompt_injection.py`
