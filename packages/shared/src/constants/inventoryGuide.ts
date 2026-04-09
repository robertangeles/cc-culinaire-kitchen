// ─────────────────────────────────────────────────────────────
// Inventory Tab Guides — Tooltip text + tutorial content
// One entry per Inventory tab. Used by hover tooltips and the
// collapsible tutorial sidebar.
// ─────────────────────────────────────────────────────────────

export interface TabGuide {
  readonly key: string;
  readonly tooltip: string;
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly tips?: readonly string[];
}

export const INVENTORY_TAB_GUIDES: Record<string, TabGuide> = {
  dashboard: {
    key: "dashboard",
    tooltip: "Your inventory at a glance — stock health, alerts, and setup progress",
    title: "Dashboard Guide",
    why: "The Dashboard gives you a real-time snapshot of your location's inventory health. You can see what's running low, what's critical, and whether your stock counts are up to date — all in one place. If your location still needs setup, the progress checklist at the top guides you through each step.",
    steps: [
      "Select your location from the dropdown at the top of the page.",
      "Check the stock status cards — green means healthy, amber means low, red means critical.",
      "If you see a Setup Progress card, follow the steps to activate items and complete your opening count.",
      "Review the inventory value breakdown by category to understand where your money sits.",
      "Click into any low or critical item to see its details and par level.",
    ],
    tips: [
      "Items show as 'Low' when they drop below 75% of their par level, and 'Critical' below 25%.",
      "The dashboard refreshes each time you navigate to it — you're always seeing current data.",
      "Org admins see a summary of all locations. Click any location row to drill into its details.",
    ],
  },

  setup: {
    key: "setup",
    tooltip: "Set up your location — activate items and complete your opening inventory count",
    title: "Setup Guide",
    why: "Before your location can start tracking inventory, you need to tell the system what you carry and how much you have. The Setup tab walks you through activating items from the master catalogue and running your first stock count. This only needs to be done once per location.",
    steps: [
      "Start with the Activation Wizard — browse the catalogue and toggle on every item your location carries.",
      "Use 'Activate All' on a category to quickly enable an entire group, then toggle off the few you don't carry.",
      "If another location is already set up, use 'Copy from Location' to start with their item list.",
      "Once items are activated, scroll down to the Opening Inventory section.",
      "Tap 'Start Opening Inventory' to begin your first count. Count every item, category by category.",
      "When all categories are counted and submitted, the system records your baseline stock and marks your location as active.",
    ],
    tips: [
      "You don't need to activate everything at once — you can come back and add more items later.",
      "The opening count is different from a regular stock take. It sets your baseline — there's no variance to calculate yet.",
      "After the opening count is complete, your Dashboard will light up with real data.",
    ],
  },

  "stock-take": {
    key: "stock-take",
    tooltip: "Count your stock — run full inventory counts or quick cycle counts by category",
    title: "Stock Take Guide",
    why: "A stock take is how you keep your inventory accurate. Walk around your location, count what's on the shelves and in the cool room, and the system calculates variance against what it expected. Regular counts catch shrinkage, spoilage, and ordering errors before they become problems.",
    steps: [
      "Choose 'Full Inventory' to count everything, or 'Cycle Count' to count specific categories (e.g., just Proteins and Dairy).",
      "Claim a category to start counting — this lets other staff know you're handling that section.",
      "For each item, enter the quantity you see. Use the keypad for fast entry.",
      "If you find an item that's not in the catalogue, tap the '+' button to flag it for HQ.",
      "Once you've counted every item in a category, submit it.",
      "When all categories are submitted, hit 'Submit for Review' to send it to HQ for approval.",
    ],
    tips: [
      "Use 'Copy Last Count' to pre-fill quantities from your previous session — then adjust what's changed.",
      "Multiple staff can count different categories at the same time. Claim your category so others don't duplicate your work.",
      "Count what you actually see — don't guess. Variance is how the system learns.",
    ],
  },

  review: {
    key: "review",
    tooltip: "HQ review queue — approve, flag, or return stock take sessions from your locations",
    title: "Review Guide (HQ)",
    why: "Every stock take goes through HQ review before it becomes official. This ensures data quality across all your locations. You can approve clean counts, flag suspicious variances for recount, or reject entire sessions with a written reason. This is your quality gate.",
    steps: [
      "Pending sessions appear in the queue sorted by submission date — oldest first.",
      "Click into a session to see the full breakdown: categories, line items, and variance.",
      "Check for large variances — these are highlighted automatically.",
      "Approve the session if the numbers look right.",
      "If something looks off, flag specific categories with a reason. The location will see your feedback and recount those categories.",
    ],
    tips: [
      "A variance under 5% is normal for most categories. Investigate anything over 10%.",
      "Flagging is better than rejecting — it tells the location exactly which categories to recount instead of starting from scratch.",
      "Approved sessions update stock levels immediately.",
    ],
  },

  ingredients: {
    key: "ingredients",
    tooltip: "Master catalogue — manage all items, categories, allergens, and supplier links",
    title: "Catalogue Guide",
    why: "The Catalogue is the master list of everything your organisation tracks. Kitchen ingredients, front-of-house consumables, and operational supplies all live here. Every location draws from this shared catalogue — when you add an item here, it becomes available for all locations to activate.",
    steps: [
      "Use the type tabs (Kitchen, FOH, Operational) to filter items by type.",
      "Click any row to expand it and see cross-location stock levels.",
      "Click the edit icon to update an item's details, allergen flags, or supplier links.",
      "To add a new item, click the '+' button. Choose the correct item type — this sets the default FIFO mode.",
      "Set allergen flags carefully — these will display across all locations.",
    ],
    tips: [
      "Kitchen items always use FIFO (first in, first out). FOH items use FIFO for perishables only. Operational supplies never use FIFO.",
      "The category filter adjusts based on the item type you've selected — Kitchen items can't be filed under 'Cleaning'.",
      "If a location needs a niche item, they can request it during a stock take. It will appear in the Requests tab for your approval.",
    ],
  },

  suppliers: {
    key: "suppliers",
    tooltip: "Manage your suppliers — contacts, delivery schedules, payment terms, and location assignments",
    title: "Suppliers Guide",
    why: "Suppliers are linked to your items so you can track costs, lead times, and ordering methods. When you assign a supplier to an item, you're recording who you buy it from and at what price. This data feeds into purchase orders and cost analysis as the system grows.",
    steps: [
      "Add a new supplier with their contact details, delivery days, and payment terms.",
      "Assign suppliers to locations — not every supplier delivers to every location.",
      "Link suppliers to items in the Catalogue tab (edit an item, then manage its suppliers).",
      "Mark one supplier as 'Preferred' per item — this is the default for purchase orders.",
    ],
    tips: [
      "Lead time matters — it tells the system how early to suggest a reorder.",
      "Record the ordering method (portal, email, phone) so any staff member can place an order, not just the usual person.",
      "Keep supplier notes updated — 'Volume discounts on orders over $500' is the kind of detail that saves money.",
    ],
  },

  requests: {
    key: "requests",
    tooltip: "Review item requests — approve or reject new items submitted by location staff",
    title: "Item Requests Guide (HQ)",
    why: "When location staff find items during a stock take that aren't in the catalogue, they can submit a request. This tab shows all pending requests. You decide whether to approve them (adding them to the master catalogue for all locations) or reject them with a reason.",
    steps: [
      "Review each pending request — check the item name, type, category, and which location submitted it.",
      "To approve: confirm the category and unit are correct, then click Approve. The item is added to the master catalogue instantly.",
      "To reject: click Reject, enter a reason (e.g., 'Already exists as Olive Oil — Extra Virgin'), and submit.",
      "The requesting location sees approval or rejection with your notes.",
    ],
    tips: [
      "Check for duplicates before approving — staff might submit 'EVOO' when 'Extra Virgin Olive Oil' already exists.",
      "Approved items are automatically activated at the requesting location.",
      "Rejected requests don't disappear — the location can see the reason and resubmit with corrections if needed.",
    ],
  },
};
