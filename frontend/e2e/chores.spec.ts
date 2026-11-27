import { expect, test, type Locator, type Page } from '@playwright/test'
import { enterParentMode, exitParentModeToJane, isCompose, openJaneChart, pickChoices, pressImDone } from './helpers'

test.skip(isCompose, 'relies on mock scenarios (seeded chores)')

const TASKS = ['Sort the laundry', 'Fold the towels', 'Put the clothes away']

interface AssignOptions {
  name: string
  tasks?: string[]
  child?: string
  doneAlready?: boolean
}

/** Opens the "Assign a chore" form (Parent home or the Chores page) and fills it. Does not press Save. */
async function fillAssignForm(page: Page, { name, tasks = [], child = 'Jane Doe', doneAlready = false }: AssignOptions): Promise<Locator> {
  await page.getByRole('button', { name: 'Assign a chore', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Assign a chore' })
  await expect(form).toBeVisible()
  await form.getByRole('checkbox', { name: child }).check()
  await form.getByRole('textbox', { name: 'Chore name' }).fill(name)
  for (const [i, label] of tasks.entries()) {
    await form.getByRole('button', { name: 'Add task' }).click()
    await form.getByRole('textbox', { name: `Task ${i + 1}`, exact: true }).fill(label)
  }
  if (doneAlready) await form.getByRole('switch', { name: /Done already/ }).check()
  return form
}

/** Assigns a chore and waits for the form to close with the confirmation note. */
async function assignChore(page: Page, options: AssignOptions): Promise<void> {
  const form = await fillAssignForm(page, options)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: `Assigned ${options.name} to ${options.child ?? 'Jane Doe'}.` })).toBeVisible()
}

/** Parent Mode -> Chores page. */
async function openChoresPage(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Chores', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Chores', exact: true })).toBeVisible()
}

const choreCard = (page: Page, section: 'To do' | 'Done and missed', name: string) =>
  page.getByRole('region', { name: section }).getByRole('listitem', { name, exact: true })

/** Picks the first sticker on the pick screen and returns to Jane's chart. */
async function pickFirstAndReturn(page: Page): Promise<string[]> {
  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible({ timeout: 20_000 })
  await expect(pickChoices(page)).toHaveCount(3)
  const names = (await pickChoices(page).allInnerTexts()).map((t) => t.trim()).sort()
  await pickChoices(page).first().click()
  await expect(page.getByRole('heading', { name: "It's in your Sticker Book!" })).toBeVisible()
  await page.getByRole('button', { name: 'Back to my chart' }).click()
  return names
}

async function expectInStickerBook(page: Page, choreName: string): Promise<void> {
  await page.getByRole('link', { name: /Sticker Book|My Sticker Book/ }).first().click()
  await expect(page.getByRole('heading', { name: 'My Sticker Book' })).toBeVisible()
  await expect(page.getByTestId('book-sticker').filter({ hasText: choreName }).first()).toBeVisible()
}

test('assign a chore with three tasks, the child finishes it and the Sticker Book names the chore', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)
  await assignChore(page, { name: 'Do the laundry', tasks: TASKS })
  await exitParentModeToJane(page)

  // The chore sits in the Chores group, below the routines.
  const group = page.getByTestId('chores-group')
  await expect(group.getByRole('heading', { name: 'Chores' })).toBeVisible()
  const card = group.getByRole('region', { name: 'Do the laundry' })
  await expect(card.getByTestId('chore-tag')).toBeVisible()
  const routine = page.getByRole('region', { name: 'Morning Routine' })
  const routineBox = await routine.boundingBox()
  const choreBox = await card.boundingBox()
  expect(choreBox!.y).toBeGreaterThan(routineBox!.y)

  // The new-chore toast; tapping it brings the card into view.
  const toast = page.getByTestId('new-chore-toast')
  await expect(toast).toContainText('New chore!')
  await expect(toast).toContainText('Do the laundry')
  await toast.click()
  await expect(toast).toHaveCount(0)
  await expect(card).toBeInViewport()

  // I'm Done! appears only after the last task.
  const done = card.getByRole('button', { name: /I'm Done!/ })
  for (const [i, label] of TASKS.entries()) {
    await expect(done).toHaveCount(0)
    await card.getByRole('button', { name: new RegExp(label), pressed: false }).click()
    await expect(card.getByText(`${i + 1} of 3 done`).or(card.getByText(/All tasks done/))).toBeVisible()
  }
  await pressImDone(done)

  await pickFirstAndReturn(page)
  await expectInStickerBook(page, 'Do the laundry')
})

test('a chore with only a name and a picture is one tile with that name', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)
  await assignChore(page, { name: 'Water the plants' })
  await exitParentModeToJane(page)

  const card = page.getByTestId('chores-group').getByRole('region', { name: 'Water the plants' })
  await expect(card).toBeVisible()
  await expect(card.getByText('0 of 1 done')).toBeVisible()
  const tiles = card.getByRole('listitem').getByRole('button')
  await expect(tiles).toHaveCount(1)
  await expect(tiles.first()).toContainText('Water the plants')
})

test('taking a chore sticker back puts the chore back on the chart with the same three choices', async ({ page }) => {
  await openJaneChart(page, 'chore-ready')
  const card = page.getByTestId('chores-group').getByRole('region', { name: 'Tidy the playroom' })
  await pressImDone(card.getByRole('button', { name: /I'm Done!/ }))
  const firstChoices = await pickFirstAndReturn(page)

  await enterParentMode(page)
  await openChoresPage(page)
  expect(await page.getByRole('region', { name: 'To do' }).getByRole('listitem').count()).toBe(0)
  const closed = choreCard(page, 'Done and missed', 'Tidy the playroom')
  await expect(closed).toBeVisible()
  await closed.getByRole('button', { name: /^Books on the shelf/ }).click()

  const sheet = page.getByRole('dialog', { name: 'Remove this sticker?' })
  await expect(sheet).toContainText("Tidy the playroom will go back on Jane Doe's chart.")
  await sheet.getByRole('button', { name: 'Remove sticker' }).click()
  await expect(page.getByTestId('chores-note')).toContainText('Sticker removed.')

  // Back under To do, the other two tasks still checked.
  const todo = choreCard(page, 'To do', 'Tidy the playroom')
  await expect(todo).toBeVisible()
  await expect(choreCard(page, 'Done and missed', 'Tidy the playroom')).toHaveCount(0)
  await expect(todo.getByRole('checkbox', { name: 'Blocks in the box' })).toBeChecked()
  await expect(todo.getByRole('checkbox', { name: 'Books on the shelf' })).not.toBeChecked()
  await expect(todo.getByRole('checkbox', { name: 'Teddies on the bed' })).toBeChecked()

  await exitParentModeToJane(page)
  const back = page.getByTestId('chores-group').getByRole('region', { name: 'Tidy the playroom' })
  await expect(back.getByText('2 of 3 done')).toBeVisible()
  await back.getByRole('button', { name: /Books on the shelf/, pressed: false }).click()
  await pressImDone(back.getByRole('button', { name: /I'm Done!/ }))

  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible({ timeout: 20_000 })
  await expect(pickChoices(page)).toHaveCount(3)
  expect((await pickChoices(page).allInnerTexts()).map((t) => t.trim()).sort()).toEqual(firstChoices)
})

test('taking a chore sticker back and removing the chore too leaves it nowhere', async ({ page }) => {
  await openJaneChart(page, 'chore-ready')
  const card = page.getByTestId('chores-group').getByRole('region', { name: 'Tidy the playroom' })
  await pressImDone(card.getByRole('button', { name: /I'm Done!/ }))
  await pickFirstAndReturn(page)

  await enterParentMode(page)
  await openChoresPage(page)
  const closed = choreCard(page, 'Done and missed', 'Tidy the playroom')
  await closed.getByRole('button', { name: /^Books on the shelf/ }).click()

  const sheet = page.getByRole('dialog', { name: 'Remove this sticker?' })
  await sheet.getByRole('checkbox', { name: 'Remove this chore too' }).check()
  await expect(sheet).toContainText('Tidy the playroom will be removed.')
  await sheet.getByRole('button', { name: 'Remove sticker' }).click()
  await expect(page.getByTestId('chores-note')).toContainText('The chore was removed too.')

  await expect(choreCard(page, 'To do', 'Tidy the playroom')).toHaveCount(0)
  await expect(choreCard(page, 'Done and missed', 'Tidy the playroom')).toHaveCount(0)

  await exitParentModeToJane(page)
  await expect(page.getByRole('region', { name: 'Tidy the playroom' })).toHaveCount(0)
  await expect(page.getByTestId('chores-group')).toHaveCount(0)
})

test('a chore that is done already lets the parent hand the child the pick right away', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)
  const form = await fillAssignForm(page, { name: 'Wash the car', tasks: ['Soap it', 'Rinse it'], doneAlready: true })
  await form.getByRole('button', { name: 'Save' }).click()

  const offer = page.getByTestId('chore-pick-offer')
  await expect(offer).toContainText('Jane Doe earned a sticker for Wash the car!')
  await offer.getByRole('button', { name: 'Let Jane Doe pick now' }).click()

  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible({ timeout: 20_000 })
  await expect(pickChoices(page)).toHaveCount(3)
  await pickChoices(page).first().click()
  await expect(page.getByRole('heading', { name: "It's in your Sticker Book!" })).toBeVisible()
  await page.getByRole('button', { name: 'See my Sticker Book' }).click()
  await expect(page.getByRole('heading', { name: 'My Sticker Book' })).toBeVisible()
  await expect(page.getByTestId('book-sticker').filter({ hasText: 'Wash the car' }).first()).toBeVisible()
})

test('a chore due today says so, and shows the tasks already done', async ({ page }) => {
  await openJaneChart(page, 'chore-waiting')
  const group = page.getByTestId('chores-group')

  const tidy = group.getByRole('region', { name: 'Tidy the playroom' })
  await expect(tidy.getByTestId('chore-due')).toHaveText('Today only')
  await expect(tidy.getByText('1 of 3 done')).toBeVisible()
  await expect(tidy.getByRole('button', { name: /Blocks in the box/, pressed: true })).toBeVisible()
  await expect(tidy.getByRole('button', { name: /Books on the shelf/, pressed: false })).toBeVisible()
  await expect(tidy.getByRole('button', { name: /Teddies on the bed/, pressed: false })).toBeVisible()

  const fish = group.getByRole('region', { name: 'Feed the fish' })
  await expect(fish).toBeVisible()
  await expect(fish.getByTestId('chore-due')).toHaveCount(0)
})

test("a chore that is ready to finish still shows I'm Done! after a reload", async ({ page }) => {
  await openJaneChart(page, 'chore-ready')
  const done = page.getByRole('region', { name: 'Tidy the playroom' }).getByRole('button', { name: /I'm Done!/ })
  await expect(done).toBeVisible()

  // In-app navigation dropped `?scenario=`, so a full load needs it again (the fake API lives in the page and is
  // re-seeded on every full load, as in pick-reload.spec.ts).
  await page.goto(`${new URL(page.url()).pathname}?scenario=chore-ready`)
  const jane = page.getByRole('button', { name: 'Jane Doe', exact: true })
  const parentMode = page.getByRole('button', { name: 'Parent Mode', exact: true })
  await expect(parentMode.or(jane)).toBeVisible()
  if (!(await parentMode.isVisible())) await jane.click()
  await expect(done).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tidy the playroom' }).getByText(/All tasks done/)).toBeVisible()
})

test('a sixth chore for one child is refused with the limit message', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)
  for (let i = 1; i <= 5; i++) await assignChore(page, { name: `Chore number ${i}` })

  const form = await fillAssignForm(page, { name: 'Chore number 6' })
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByRole('alert')).toContainText('Jane Doe already has 5 chores to do.')
  await expect(form).toBeVisible()
})
