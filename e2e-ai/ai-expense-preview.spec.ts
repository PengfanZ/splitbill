import { expect, test, type Page } from '@playwright/test'

const aiPreviewURL = 'http://127.0.0.1:4184'
const aiExpenseEndpoint = `${aiPreviewURL}/functions/v1/parse-expense`

function batchResult(...drafts: Array<Record<string, unknown>>) {
  return { status: 'ready_batch', drafts }
}

test.beforeEach(async ({ context }, testInfo) => {
  if (testInfo.title === 'completes a real browser CORS preflight for voice entry') return
  await context.route(`${aiPreviewURL}/rest/v1/rpc/record_analytics_event`, route => route.fulfill({
    status: 204,
    body: '',
  }))
})

async function createPreviewActivityHome(page: Page) {
  await page.goto('./')
  await page.getByLabel('Display name').fill('Preview Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('AI preview dinner')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
}

async function createPreviewActivity(page: Page, entryMode: 'text' | 'manual' = 'text') {
  await createPreviewActivityHome(page)
  await page.getByRole('button', { name: 'Add expense' }).click()
  if (entryMode === 'text') await page.getByRole('tab', { name: 'Describe with AI' }).click()
}

async function captureAnalytics(page: Page) {
  const requests: Array<Record<string, unknown>> = []
  await page.route(`${aiPreviewURL}/rest/v1/rpc/record_analytics_event`, route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 204, body: '' })
  })
  return requests
}

async function enableFakeVoiceRecording(page: Page, permissionGranted = true) {
  await page.addInitScript((granted: boolean) => {
    const track = { stop() {} }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: granted
          ? async () => ({ getTracks: () => [track] })
          : async () => { throw new DOMException('Denied', 'NotAllowedError') },
      },
    })
    class FakeAudioContext {
      async decodeAudioData() {
        return {
          numberOfChannels: 1,
          length: 16_000,
          sampleRate: 16_000,
          getChannelData: () => new Float32Array(16_000),
        }
      }
      async close() {}
    }
    class FakeMediaRecorder {
      static isTypeSupported() { return true }
      state: RecordingState = 'inactive'
      mimeType: string
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? 'audio/webm'
      }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['recording']) })
        this.onstop?.()
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder })
  }, permissionGranted)
}

test('keeps manual expense entry first while offering text and voice alternatives', async ({ page }) => {
  await createPreviewActivity(page, 'manual')
  await expect(page.getByRole('tab', { name: 'Enter manually' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Description')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Describe with AI' })).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('tab', { name: 'Speak' })).toHaveAttribute('aria-selected', 'false')
})

test('clarifies an incomplete description locally, then sends structured follow-up context', async ({ page }) => {
  let aiRequests = 0
  await page.route(aiExpenseEndpoint, async route => {
    aiRequests += 1
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({
      text: 'dinner',
      viewerMemberId: 'me',
      clarifications: [{
        question: 'Please add the total amount, who paid, and who should be included in the split.',
        answer: 'Maya paid $30 and split it with me',
      }],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult({
          status: 'ready',
          title: 'Dinner',
          amountCents: 3_000,
          payerId: body.members[1].id,
          splitMethod: 'equal',
          participantIds: body.members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        }),
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('dinner')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText(
    'Please add the total amount, who paid, and who should be included in the split.',
  )
  await expect(page.getByLabel('Your answer')).toBeEditable()
  expect(aiRequests).toBe(0)

  await page.getByLabel('Your answer').fill('Maya paid $30 and split it with me')
  await page.getByRole('button', { name: 'Update draft' }).click()
  await expect(page.getByRole('status')).toContainText('AI draft ready')
  expect(aiRequests).toBe(1)
})

test('retains earlier answers across multiple model follow-up questions', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = []
  await page.route(aiExpenseEndpoint, async route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    const members = body.members as Array<{ id: string; name: string }>
    const result = requests.length === 1
      ? { status: 'needs_clarification', question: 'Who paid?' }
      : requests.length === 2
        ? { status: 'needs_clarification', question: 'Who should share it?' }
        : batchResult({
            status: 'ready',
            title: 'Dinner',
            amountCents: 3_000,
            payerId: members[1].id,
            splitMethod: 'equal',
            participantIds: members.map(member => member.id),
            exactSharesCents: [],
          })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Dinner was $30')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('status')).toContainText('Who paid?')

  await page.getByLabel('Your answer').fill('Maya paid')
  await page.getByRole('button', { name: 'Update draft' }).click()
  await expect(page.getByRole('status')).toContainText('Who should share it?')

  await page.getByLabel('Your answer').fill('Preview Tester and Maya')
  await page.getByRole('button', { name: 'Update draft' }).click()
  await expect(page.getByRole('status')).toContainText('AI draft ready')

  expect(requests).toHaveLength(3)
  expect(requests[1]).toMatchObject({
    text: 'Dinner was $30',
    clarifications: [{ question: 'Who paid?', answer: 'Maya paid' }],
  })
  expect(requests[2]).toMatchObject({
    text: 'Dinner was $30',
    clarifications: [
      { question: 'Who paid?', answer: 'Maya paid' },
      { question: 'Who should share it?', answer: 'Preview Tester and Maya' },
    ],
  })
})

test('turns a description into a reviewable draft before the user saves it', async ({ page }) => {
  let aiRequests = 0
  const analyticsRequests = await captureAnalytics(page)
  await page.route(aiExpenseEndpoint, async route => {
    aiRequests += 1
    const request = route.request()
    expect(request.method()).toBe('POST')
    expect(request.headers().apikey).toBe('test-publishable-key')
    expect(request.postDataJSON()).toMatchObject({
      text: 'Maya paid $36 for dinner, split between Maya and me',
      currency: 'USD',
      viewerMemberId: 'me',
      responseMode: 'batch',
      members: [
        { id: 'me', name: 'Preview Tester' },
        { name: 'Maya' },
      ],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult({
          status: 'ready',
          title: 'Dinner',
          amountCents: 3_600,
          payerId: request.postDataJSON().members[1].id,
          splitMethod: 'equal',
          participantIds: request.postDataJSON().members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        }),
        model: 'google/gemma-4-26b-a4b-it:free',
      }),
    })
  })

  await createPreviewActivity(page)
  await expect(page.getByRole('tab', { name: 'Describe with AI' })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Expense description').fill('Maya paid $36 for dinner, split between Maya and me')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByLabel('Description')).toHaveValue('Dinner')
  await expect(page.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('36')
  await expect(page.getByRole('button', { name: 'Paid by' })).toContainText('Maya')
  await expect(page.getByRole('button', { name: 'Save expense' })).toBeVisible()
  await expect(page.getByText('Dinner', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Dinner', { exact: true })).toBeVisible()
  await expect(page.locator('.expense-amount b')).toHaveText('$36.00')
  expect(aiRequests).toBe(1)
  expect(analyticsRequests.map(request => request.p_event_name)).toEqual(expect.arrayContaining([
    'expense_input_ai_text_selected',
    'ai_text_requested',
    'ai_text_ready',
  ]))
  const aiAnalyticsRequests = analyticsRequests.filter(request => String(request.p_event_name).startsWith('ai_'))
  expect(aiAnalyticsRequests).toEqual(aiAnalyticsRequests.map(request => ({
    p_event_name: request.p_event_name,
    p_surface: 'local',
    p_session_token: request.p_session_token,
    p_locale: 'en',
    p_currency: null,
  })))
})

test('reviews and saves several text expenses together without partial persistence', async ({ page }) => {
  await page.route(aiExpenseEndpoint, async route => {
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({
      responseMode: 'batch',
      text: 'I paid $24 for lunch and Maya paid $46 for groceries. Split both between everyone.',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult(
          {
            status: 'ready', title: 'Lunch', amountCents: 2_400, payerId: body.members[0].id,
            splitMethod: 'equal', participantIds: body.members.map((member: { id: string }) => member.id),
            exactSharesCents: [],
          },
          {
            status: 'ready', title: 'Groceries', amountCents: 4_600, payerId: body.members[1].id,
            splitMethod: 'equal', participantIds: body.members.map((member: { id: string }) => member.id),
            exactSharesCents: [],
          },
        ),
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill(
    'I paid $24 for lunch and Maya paid $46 for groceries. Split both between everyone.',
  )
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByText('2 expense drafts ready')).toBeVisible()
  await expect(page.getByText('Nothing is saved until you confirm the whole batch.')).toBeVisible()
  await page.getByRole('button', { name: 'Save 2 expenses' }).click()
  await expect(page.getByText('Lunch', { exact: true })).toBeVisible()
  await expect(page.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(page.locator('.activity-row')).toHaveCount(2)
})

test('reviews and saves more than ten text expenses without an app-level count limit', async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 720 })
  await page.route(aiExpenseEndpoint, async route => {
    const body = route.request().postDataJSON()
    const participantIds = body.members.map((member: { id: string }) => member.id)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult(...Array.from({ length: 11 }, (_, index) => ({
          status: 'ready',
          title: `Expense ${index + 1}`,
          amountCents: (index + 1) * 100,
          payerId: body.members[0].id,
          splitMethod: 'equal',
          participantIds,
          exactSharesCents: [],
        }))),
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Add eleven numbered expenses, paid by me and split with everyone.')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByText('11 expense drafts ready')).toBeVisible()
  await expect(page.getByText('Expense 11', { exact: true })).toBeVisible()
  const saveButton = page.getByRole('button', { name: 'Save 11 expenses' })
  await expect(saveButton).toBeVisible()
  const saveButtonBox = await saveButton.boundingBox()
  expect(saveButtonBox).not.toBeNull()
  expect((saveButtonBox?.y ?? 0) + (saveButtonBox?.height ?? 0)).toBeLessThanOrEqual(720)
  await saveButton.click()
  await expect(page.locator('.activity-row')).toHaveCount(11)
  await expect(page.getByText('Expense 11', { exact: true })).toBeVisible()
})

test('sends a substantive non-English description to the model without an English-only gate', async ({ page }) => {
  let aiRequests = 0
  await page.route(aiExpenseEndpoint, async route => {
    aiRequests += 1
    const body = route.request().postDataJSON()
    expect(body.text).toBe('Maya pagó 36 € por la cena y lo dividimos entre Maya y yo')
    expect(body.locale).toBe('en')
    expect(body).not.toHaveProperty('clarification')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult({
          status: 'ready',
          title: 'Cena',
          amountCents: 3_600,
          payerId: body.members[1].id,
          splitMethod: 'equal',
          participantIds: body.members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        }),
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Maya pagó 36 € por la cena y lo dividimos entre Maya y yo')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByLabel('Description')).toHaveValue('Cena')
  expect(aiRequests).toBe(1)
})

test('explains a legacy unsafe-model response without calling the model unavailable', async ({ page }) => {
  await page.route(aiExpenseEndpoint, route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'invalid_model_response',
      message: 'The AI response could not be safely converted into an expense.',
    }),
  }))

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Something happened with dinner and the group')
  await page.getByRole('button', { name: 'Create draft' }).click()

  const error = page.getByRole('alert')
  await expect(error).toContainText('Tally could not turn that into a reliable draft.')
  await expect(error).not.toContainText('unavailable')
})

test('identifies an upstream model failure instead of blaming the expense description', async ({ page }) => {
  await page.route(aiExpenseEndpoint, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'model_unavailable',
      message: 'The configured AI models could not respond.',
    }),
  }))

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Maya paid $30 for dinner, split between everyone')
  await page.getByRole('button', { name: 'Create draft' }).click()

  const error = page.getByRole('alert')
  await expect(error).toContainText('free AI model and its low-cost backup both failed')
  await expect(error).not.toContainText('Restate the total amount')
})

test('turns a short voice recording into a reviewable expense batch', async ({ page }) => {
  await enableFakeVoiceRecording(page)
  let aiRequests = 0
  const analyticsRequests = await captureAnalytics(page)
  await page.route(aiExpenseEndpoint, async route => {
    aiRequests += 1
    const request = route.request()
    const body = request.postDataJSON()
    expect(request.headers()['x-tally-input-mode']).toBe('voice')
    expect(body).toMatchObject({
      inputMode: 'voice',
      audio: { format: 'wav', durationSeconds: 1 },
      currency: 'USD',
      viewerMemberId: 'me',
      responseMode: 'batch',
    })
    expect(body).not.toHaveProperty('text')
    expect(body.audio.data).toMatch(/^UklGR/)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult(
          {
            status: 'ready', title: 'Voice dinner', amountCents: 4_200, payerId: body.members[1].id,
            splitMethod: 'equal', participantIds: body.members.map((member: { id: string }) => member.id),
            exactSharesCents: [],
          },
          {
            status: 'ready', title: 'Voice taxi', amountCents: 1_800, payerId: body.members[0].id,
            splitMethod: 'equal', participantIds: body.members.map((member: { id: string }) => member.id),
            exactSharesCents: [],
          },
        ),
      }),
    })
  })

  await createPreviewActivity(page, 'manual')
  await page.getByRole('tab', { name: 'Speak' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Listening… tap to stop')).toBeVisible()
  await page.getByRole('button', { name: 'Stop recording' }).click()

  await expect(page.getByText('2 expense drafts ready')).toBeVisible()
  await page.getByRole('button', { name: 'Save 2 expenses' }).click()
  await expect(page.getByText('Voice dinner', { exact: true })).toBeVisible()
  await expect(page.getByText('Voice taxi', { exact: true })).toBeVisible()
  expect(aiRequests).toBe(1)
  expect(analyticsRequests.map(request => request.p_event_name)).toEqual(expect.arrayContaining([
    'expense_input_ai_voice_selected',
    'ai_voice_requested',
    'ai_voice_ready',
  ]))
})

test('maps first-person AI entry to the participant selected on this browser', async ({ page }) => {
  let selectedMemberId = ''
  await page.route(aiExpenseEndpoint, async route => {
    const body = route.request().postDataJSON()
    selectedMemberId = body.members.find((member: { name: string }) => member.name === 'Maya').id
    expect(body).toMatchObject({
      text: 'I paid $18 for coffee with Preview Tester',
      viewerMemberId: selectedMemberId,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: batchResult({
          status: 'ready',
          title: 'Coffee',
          amountCents: 1_800,
          payerId: selectedMemberId,
          splitMethod: 'equal',
          participantIds: body.members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        }),
      }),
    })
  })

  await createPreviewActivityHome(page)
  await page.getByRole('button', { name: 'Selected identity: Preview Tester' }).click()
  await page.getByRole('option', { name: 'Maya' }).click()
  await expect(page.getByRole('button', { name: 'Selected identity: Maya' })).toBeVisible()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByRole('tab', { name: 'Describe with AI' }).click()
  await page.getByLabel('Expense description').fill('I paid $18 for coffee with Preview Tester')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByRole('button', { name: 'Paid by' })).toContainText('Maya')
  expect(selectedMemberId).not.toBe('')
})

test('completes a real browser CORS preflight for voice entry', async ({ page }) => {
  await enableFakeVoiceRecording(page)
  await createPreviewActivity(page, 'manual')
  await page.getByRole('tab', { name: 'Speak' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.getByRole('button', { name: 'Stop recording' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByLabel('Description')).toHaveValue('Voice CORS dinner')
  await expect(page.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('42')
})

test('explains denied microphone permission and leaves manual entry available', async ({ page }) => {
  await enableFakeVoiceRecording(page, false)
  await createPreviewActivity(page, 'manual')
  await page.getByRole('tab', { name: 'Speak' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('alert')).toContainText('Microphone access was not granted')
  await page.getByRole('tab', { name: 'Enter manually' }).click()
  await expect(page.getByLabel('Description')).toBeEditable()
})

test('recovers immediately when a browser leaves microphone permission pending', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise<MediaStream>(() => undefined) },
    })
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: class FakeMediaRecorder {},
    })
  })
  await createPreviewActivity(page, 'manual')
  await page.getByRole('tab', { name: 'Speak' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()

  await expect(page.getByText('Starting microphone…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Starting microphone…' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel microphone request' }).click()

  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Enter manually' }).click()
  await expect(page.getByLabel('Description')).toBeEditable()
})
