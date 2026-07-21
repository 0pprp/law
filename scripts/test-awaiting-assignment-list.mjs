/**
 * Unit checks for awaiting-assignment list name resolution.
 * Run: node scripts/test-awaiting-assignment-list.mjs
 */
import assert from 'node:assert/strict'

/** Mirror of resolveBranchListName in lib/awaiting-assignment.ts */
function resolveBranchListName(embed) {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  const name = row?.name?.trim()
  return name || null
}

function display(name) {
  return name?.trim() || '—'
}

// 1. مدين مرتبط بقائمة
assert.equal(resolveBranchListName({ name: 'قائمة الكرخ' }), 'قائمة الكرخ')
assert.equal(display(resolveBranchListName({ name: 'قائمة الكرخ' })), 'قائمة الكرخ')

// 2. مدين بقائمة مختلفة — كل صف يستخرج اسمه من embed الخاص به
const a = resolveBranchListName({ name: 'قائمة أ' })
const b = resolveBranchListName({ name: 'قائمة ب' })
assert.equal(a, 'قائمة أ')
assert.equal(b, 'قائمة ب')
assert.notEqual(a, b)

// 3. غير مرتبط / قائمة محذوفة / علاقة فارغة
assert.equal(resolveBranchListName(null), null)
assert.equal(resolveBranchListName(undefined), null)
assert.equal(resolveBranchListName({ name: null }), null)
assert.equal(resolveBranchListName({ name: '   ' }), null)
assert.equal(resolveBranchListName([]), null)
assert.equal(display(null), '—')

// 4. عدة مدينين — مصفوفة embed (شكل PostgREST أحياناً)
assert.equal(resolveBranchListName([{ name: 'قائمة الرصافة' }]), 'قائمة الرصافة')

console.log('PASSED: awaiting-assignment list name resolution (cases 1-4)')
