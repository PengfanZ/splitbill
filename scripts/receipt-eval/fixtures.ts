// Synthetic receipts with computed ground truth for comparing receipt models.
// Every printed number is derived from these definitions, so the expected
// answer cannot drift from what the image shows.

export type ChargeType = 'tax' | 'tip' | 'service' | 'discount' | 'other'
export type PhotoStyle = 'clean' | 'photo' | 'faded'

type FixtureDetail = { label: string, cents?: number }
type FixtureItem = { name: string, quantity?: number, unitCents: number, details?: FixtureDetail[] }
type FixtureCharge = { type: ChargeType, label: string, cents?: number, rateBasisPoints?: number }

export type ReceiptFixture = {
  id: string
  locale: 'en' | 'zh-CN'
  currency: 'USD' | 'CNY' | 'EUR' | 'GBP'
  merchant: string
  header: string[]
  date: string
  items: FixtureItem[]
  charges: FixtureCharge[]
  printSubtotal: boolean
  footer: string[]
  labels: { subtotal: string, total: string }
  style: PhotoStyle
  rotateDeg: number
}

export type ReceiptTruth = {
  currency: string
  itemCount: number
  itemTotals: number[]
  charges: { type: ChargeType, cents: number }[]
  subtotalCents: number
  totalCents: number
}

export function itemTotalCents(item: FixtureItem) {
  const details = (item.details ?? []).reduce((sum, detail) => sum + (detail.cents ?? 0), 0)
  return (item.quantity ?? 1) * item.unitCents + details
}

// Rate-based charges apply to the item subtotal and round half up, like most POS systems.
export function chargeCents(charge: FixtureCharge, subtotalCents: number) {
  if (charge.cents !== undefined) return charge.cents
  return Math.round(subtotalCents * (charge.rateBasisPoints ?? 0) / 10_000)
}

export function receiptTruth(fixture: ReceiptFixture): ReceiptTruth {
  const itemTotals = fixture.items.map(itemTotalCents)
  const subtotalCents = itemTotals.reduce((sum, cents) => sum + cents, 0)
  const charges = fixture.charges.map(charge => ({ type: charge.type, cents: chargeCents(charge, subtotalCents) }))
  return {
    currency: fixture.currency,
    itemCount: itemTotals.length,
    itemTotals,
    charges,
    subtotalCents,
    totalCents: subtotalCents + charges.reduce((sum, charge) => sum + charge.cents, 0),
  }
}

const groceryItems: FixtureItem[] = [
  ['ORG BANANAS', 179], ['2% MILK 1GAL', 449], ['LARGE EGGS 12CT', 389], ['SOURDOUGH LOAF', 549],
  ['BABY SPINACH 5OZ', 399], ['CHKN THIGHS BNLS', 1187], ['GREEK YOGURT', 129], ['GREEK YOGURT', 129],
  ['CHEDDAR BLOCK', 479], ['PASTA PENNE', 199], ['MARINARA 24OZ', 429], ['OLIVE OIL XV', 1299],
  ['AVOCADO', 125], ['AVOCADO', 125], ['LIMES 2LB', 349], ['CILANTRO', 99], ['TORTILLAS CORN', 279],
  ['BLACK BEANS', 119], ['BLACK BEANS', 119], ['RICE JASMINE 5LB', 899], ['COFFEE BEANS', 1149],
  ['OAT MILK', 499], ['APPLES HONEYCRISP', 612], ['PAPER TOWELS 6PK', 1099], ['DISH SOAP', 379],
  ['TRASH BAGS 40CT', 949], ['SPARKLING WATER', 599], ['DARK CHOCOLATE', 349],
].map(([name, unitCents]) => ({ name: String(name), unitCents: Number(unitCents) }))

export const RECEIPT_FIXTURES: ReceiptFixture[] = [
  {
    id: 'diner-clean',
    locale: 'en', currency: 'USD', merchant: 'LUCKY STAR DINER',
    header: ['214 W 23rd St, New York NY', 'Table 12  Server: Ana'], date: '09/18/2026 7:42 PM',
    items: [
      { name: 'Classic Cheeseburger', unitCents: 1650 },
      { name: 'Buttermilk Pancakes', unitCents: 1295 },
      { name: 'Cobb Salad', unitCents: 1575 },
      { name: 'Sweet Potato Fries', unitCents: 725 },
      { name: 'Iced Tea', quantity: 2, unitCents: 395 },
      { name: 'Vanilla Milkshake', unitCents: 850 },
    ],
    charges: [{ type: 'tax', label: 'Sales Tax 8.875%', rateBasisPoints: 887.5 }],
    printSubtotal: true, footer: ['Thank you! Come again'],
    labels: { subtotal: 'Subtotal', total: 'TOTAL' }, style: 'clean', rotateDeg: 0,
  },
  {
    id: 'modifiers-photo',
    locale: 'en', currency: 'USD', merchant: 'GREEN BOWL KITCHEN',
    header: ['Order #4471  Dine in'], date: '09/19/2026 12:18 PM',
    items: [
      { name: 'Build Your Bowl', unitCents: 1395, details: [{ label: 'Brown rice' }, { label: '+ Avocado', cents: 250 }, { label: '+ Extra chicken', cents: 400 }] },
      { name: 'Spicy Tofu Wrap', unitCents: 1250, details: [{ label: 'No onions' }, { label: 'Sub gluten-free wrap', cents: 150 }] },
      { name: 'Miso Soup', quantity: 3, unitCents: 450 },
      { name: 'Kombucha', quantity: 2, unitCents: 575 },
      { name: 'Matcha Latte', unitCents: 595, details: [{ label: 'Oat milk', cents: 75 }] },
    ],
    charges: [{ type: 'tax', label: 'Tax', rateBasisPoints: 875 }],
    printSubtotal: true, footer: ['Powered by Toast'],
    labels: { subtotal: 'Subtotal', total: 'Total' }, style: 'photo', rotateDeg: -1.5,
  },
  {
    id: 'discounts-photo',
    locale: 'en', currency: 'USD', merchant: 'HARBOR TAP HOUSE',
    header: ['Happy Hour 4-6PM'], date: '09/20/2026 5:36 PM',
    items: [
      { name: 'IPA Draft', quantity: 3, unitCents: 800, details: [{ label: 'Happy hour', cents: -600 }] },
      { name: 'Fish Tacos', unitCents: 1600 },
      { name: 'Wings (12)', unitCents: 1800, details: [{ label: 'Buffalo' }, { label: 'Extra ranch', cents: 100 }] },
      { name: 'Truffle Fries', unitCents: 1100 },
      { name: 'House Red Glass', quantity: 2, unitCents: 1200 },
    ],
    charges: [
      { type: 'tax', label: 'Tax 6%', rateBasisPoints: 600 },
      { type: 'discount', label: 'Loyalty reward', cents: -1000 },
    ],
    printSubtotal: true, footer: ['Members save every visit'],
    labels: { subtotal: 'Subtotal', total: 'Balance Due' }, style: 'photo', rotateDeg: 0.8,
  },
  {
    id: 'service-tip-photo',
    locale: 'en', currency: 'USD', merchant: 'OSTERIA LUNA',
    header: ['Party of 8 - Table 30'], date: '09/21/2026 9:05 PM',
    items: [
      { name: 'Burrata', unitCents: 1900 }, { name: 'Calamari Fritti', unitCents: 1700 },
      { name: 'Cacio e Pepe', quantity: 2, unitCents: 2400 }, { name: 'Rigatoni Bolognese', unitCents: 2600 },
      { name: 'Branzino', unitCents: 3800 }, { name: 'Margherita Pizza', unitCents: 1900 },
      { name: 'Tiramisu', quantity: 2, unitCents: 1200 }, { name: 'Bottle Chianti', unitCents: 6200 },
    ],
    charges: [
      { type: 'service', label: 'Service Charge 18% (8+)', rateBasisPoints: 1800 },
      { type: 'tax', label: 'Sales Tax 8.875%', rateBasisPoints: 887.5 },
      { type: 'tip', label: 'Additional Tip', cents: 2000 },
    ],
    printSubtotal: true,
    footer: ['Suggested gratuity:', '  18% = $45.54   20% = $50.60', '  22% = $55.66', 'Grazie!'],
    labels: { subtotal: 'Food & Bev Subtotal', total: 'TOTAL CHARGED' }, style: 'photo', rotateDeg: -1,
  },
  {
    id: 'zh-restaurant-photo',
    locale: 'zh-CN', currency: 'CNY', merchant: '川味小馆',
    header: ['桌号: A08  人数: 4', '收银员: 王芳'], date: '2026-09-20 18:47',
    items: [
      { name: '水煮鱼', unitCents: 8800 }, { name: '宫保鸡丁', unitCents: 4200 },
      { name: '麻婆豆腐', unitCents: 2800 }, { name: '干煸四季豆', unitCents: 3200 },
      { name: '米饭', quantity: 4, unitCents: 300 },
      { name: '酸梅汤', quantity: 2, unitCents: 1200, details: [{ label: '少冰' }] },
      { name: '红糖糍粑', unitCents: 2200 },
    ],
    charges: [
      { type: 'service', label: '服务费 10%', rateBasisPoints: 1000 },
      { type: 'discount', label: '会员优惠', cents: -1500 },
    ],
    printSubtotal: true, footer: ['谢谢惠顾，欢迎再次光临'],
    labels: { subtotal: '小计', total: '实付金额' }, style: 'photo', rotateDeg: 1.5,
  },
  {
    id: 'grocery-long',
    locale: 'en', currency: 'USD', merchant: 'FRESH MARKET #218',
    header: ['1201 Chestnut St Philadelphia PA', 'Lane 4  Cashier 0192'], date: '09/22/2026 6:11 PM',
    items: groceryItems,
    charges: [{ type: 'tax', label: 'TAX 6.000%', rateBasisPoints: 600 }],
    printSubtotal: true, footer: ['ITEMS SOLD 28', 'VISA **** CHIP  APPROVED'],
    labels: { subtotal: 'SUBTOTAL', total: '**** TOTAL' }, style: 'photo', rotateDeg: -1,
  },
  {
    id: 'cafe-no-subtotal',
    locale: 'en', currency: 'EUR', merchant: 'CAFÉ DES ARTS',
    header: ['12 Rue Oberkampf, Paris'], date: '21/09/2026 10:04',
    items: [
      { name: 'Croissant', quantity: 2, unitCents: 180 },
      { name: 'Pain au chocolat', unitCents: 210 },
      { name: 'Café crème', quantity: 2, unitCents: 420 },
      { name: 'Jus d’orange pressé', unitCents: 550 },
    ],
    charges: [],
    printSubtotal: false, footer: ['TVA 10% incluse', 'Merci et à bientôt'],
    labels: { subtotal: '', total: 'TOTAL TTC' }, style: 'clean', rotateDeg: 0,
  },
  {
    id: 'diner-faded',
    locale: 'en', currency: 'USD', merchant: 'SUNRISE DINER',
    header: ['Booth 4'], date: '09/14/2026 8:55 AM',
    items: [
      { name: 'Western Omelette', unitCents: 1450, details: [{ label: 'Sub egg whites', cents: 200 }] },
      { name: 'Corned Beef Hash', unitCents: 1395 },
      { name: 'Side Bacon', unitCents: 550 },
      { name: 'Coffee', quantity: 3, unitCents: 325 },
      { name: 'Fresh OJ Large', unitCents: 675 },
    ],
    charges: [{ type: 'tax', label: 'Tax', rateBasisPoints: 800 }],
    printSubtotal: true, footer: ['Cash only after 10pm'],
    labels: { subtotal: 'Sub Total', total: 'Total' }, style: 'faded', rotateDeg: 1.5,
  },
  {
    id: 'zh-milk-tea-faded',
    locale: 'zh-CN', currency: 'CNY', merchant: '一点点奶茶 (人民广场店)',
    header: ['取餐号: 318'], date: '2026-09-21 15:22',
    items: [
      { name: '四季春玛奇朵', unitCents: 1500, details: [{ label: '大杯' }, { label: '少糖' }] },
      { name: '波霸奶茶', quantity: 2, unitCents: 1300, details: [{ label: '加珍珠', cents: 200 }] },
      { name: '柠檬绿茶', unitCents: 1100 },
    ],
    charges: [{ type: 'discount', label: '满30减5', cents: -500 }],
    printSubtotal: true, footer: ['请保留小票'],
    labels: { subtotal: '商品合计', total: '实收' }, style: 'faded', rotateDeg: -1.5,
  },
  {
    id: 'bar-quantities-photo',
    locale: 'en', currency: 'GBP', merchant: 'THE RED LION',
    header: ['Tab: Sam'], date: '19/09/2026 23:12',
    items: [
      { name: 'Pint Guinness', quantity: 6, unitCents: 620 },
      { name: 'G&T Double', quantity: 3, unitCents: 1150 },
      { name: 'Scampi & Chips', unitCents: 1495 },
      { name: 'Nachos to share', unitCents: 1100 },
    ],
    charges: [{ type: 'service', label: 'Optional service 12.5%', rateBasisPoints: 1250 }],
    printSubtotal: true, footer: ['VAT included where applicable'],
    labels: { subtotal: 'Subtotal', total: 'Amount due' }, style: 'photo', rotateDeg: 0.8,
  },
]
