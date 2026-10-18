import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRef, formatRef, suggestBooks, KJV_ORDER, bookName } from './books.js'

test('free-form references', () => {
	assert.deepEqual(parseRef('Joh 3,16'), { book: 'John', c1: 3, v1: 16, c2: 3, v2: 16 })
	assert.deepEqual(parseRef('Lk 4:8-10'), { book: 'Luke', c1: 4, v1: 8, c2: 4, v2: 10 })
	assert.deepEqual(parseRef('Röm 1,1–2,5'), { book: 'Rom', c1: 1, v1: 1, c2: 2, v2: 5 })
	assert.deepEqual(parseRef('1. Kön 16-17'), { book: '1Kgs', c1: 16, v1: 0, c2: 17, v2: 0 })
	assert.deepEqual(parseRef('Psalm 23'), { book: 'Ps', c1: 23, v1: 0, c2: 23, v2: 0 })
	assert.deepEqual(parseRef('1Mose'), { book: 'Gen', c1: 1, v1: 0, c2: 1, v2: 0 })
	assert.equal(parseRef('Quatsch 3'), null)
})

test('OSIS references from plans and cross references', () => {
	assert.deepEqual(parseRef('John.3.16'), { book: 'John', c1: 3, v1: 16, c2: 3, v2: 16 })
	assert.deepEqual(parseRef('Luke.4.18-Luke.4.21'), { book: 'Luke', c1: 4, v1: 18, c2: 4, v2: 21 })
	assert.deepEqual(parseRef('Gen.1'), { book: 'Gen', c1: 1, v1: 0, c2: 1, v2: 0 })
	assert.deepEqual(parseRef('Jes.7.4'), { book: 'Isa', c1: 7, v1: 4, c2: 7, v2: 4 })
	assert.deepEqual(parseRef('Gen.1.1-Gen.2.3'), { book: 'Gen', c1: 1, v1: 1, c2: 2, v2: 3 })
	assert.deepEqual(parseRef('1John.1.9'), { book: '1John', c1: 1, v1: 9, c2: 1, v2: 9 })
})

test('formatting and suggestions', () => {
	assert.equal(formatRef(parseRef('Joh 3,16-18')), 'Johannes 3,16-18')
	assert.equal(formatRef(parseRef('John 3:16'), 'en', 'John'), 'John 3:16')
	assert.deepEqual(suggestBooks('Jo').slice(0, 4), ['Josh', 'Job', 'Joel', 'Jonah'])
	assert.equal(KJV_ORDER.indexOf('Acts'), 43)
	assert.equal(bookName('1Kgs'), '1. Könige')
})
