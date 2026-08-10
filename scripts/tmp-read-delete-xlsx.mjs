import { readdirSync } from 'fs'
import { join } from 'path'
import XLSX from 'xlsx'

const dir = 'C:/Users/Marvel/Downloads/Telegram Desktop'
const wanted = [
  'الموصل يرجعون للتسديد.xlsx',
  'الناصرية يرجع للتسديد.xlsx',
  'النجف يرجع للتسديد.xlsx',
  'ديالى يرجعون للتسديد.xlsx',
  'كرخ- يرجعون للتسديد.xlsx',
  'كركوك يرجعون للتسديد.xlsx',
]

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx'))
for (const w of wanted) {
  const hit = files.find(f => f === w || f.includes(w.replace('.xlsx', '')))
  console.log('WANT:', w, '→', hit ?? 'NOT FOUND')
}

for (const f of wanted) {
  const full = join(dir, f)
  try {
    const wb = XLSX.readFile(full)
    console.log('\n===', f, '===')
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false })
      console.log('sheet', name, 'count', rows.length)
      console.log('keys', rows[0] ? Object.keys(rows[0]) : [])
      console.log(JSON.stringify(rows.slice(0, 5), null, 2))
      if (rows.length > 5) console.log('... total', rows.length)
    }
  } catch (e) {
    console.error('FAIL', f, e.message)
  }
}
