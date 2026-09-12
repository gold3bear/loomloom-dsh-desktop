import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

describe('Loomloom default LLM provider', () => {
  it('routes the default agent through the shared ShengSuanYun credential', () => {
    expect(patch).toContain('- id: llm-pi-ai')
    expect(patch).toContain('apiKeyEnv: SHENGSUANYUN_API_KEY')
    expect(patch).toContain('api: openai-completions')
    expect(patch).toContain('baseURL: https://router.shengsuanyun.com/api/v1')
    expect(patch).toContain('- id: agent-default-model')
    expect(patch).toContain('provider: shengsuanyun')
    expect(patch).toContain('model: deepseek-v4-flash')
  })

  it('disables the native DeepSeek provider while retaining the pi-ai provider surface', () => {
    expect(patch).toMatch(/- id: llm-deepseek\s+disabled: true/u)
    expect(patch).toContain('- id: llm-pi-ai')
  })
})
