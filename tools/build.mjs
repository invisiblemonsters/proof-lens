import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const src = path.join(root, '..', 'src')
const core = fs.readFileSync(path.join(src, 'core.js'), 'utf8').replace(/^export /gm, '')
const template = fs.readFileSync(path.join(src, 'plugin.template2.js'), 'utf8')
if (!template.includes('/*__CORE__*/')) throw new Error('template is missing /*__CORE__*/')
const out = template.replace('/*__CORE__*/', core.trimEnd())
fs.writeFileSync(path.join(root, '..', 'desktop', 'plugin.js'), out)
console.log('wrote desktop/plugin.js', out.length, 'bytes')
