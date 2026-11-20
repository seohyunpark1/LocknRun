// In-app Shop (Challengers-style): spend what you won on sponsor rewards and app items.
// Shared by the server (prices are enforced there) and the browser (display).

export type ShopItem = {
  id: string;
  name: string;
  brand: string; // "Lock&Run" for app items, otherwise the sponsor selling it
  price: number; // USDC
  icon: string;
  color: string; // tile background
  desc: string;
  kind: "coupon" | "giftcard" | "product" | "perk";
  codePrefix: string;
};

// Demo catalog. Peak Shoes and Austin Running Co. are the sample sponsors used in the demo.
export const SHOP_ITEMS: ShopItem[] = [
  { id: "peak-20", name: "20% off running shoes", brand: "Peak Shoes", price: 5, icon: "👟", color: "#dbeafe", kind: "coupon", codePrefix: "PEAK",
    desc: "One-time 20% off any pair of running shoes." },
  { id: "arc-15", name: "$15 gift card", brand: "Austin Running Co.", price: 12, icon: "🎁", color: "#ccfbf1", kind: "giftcard", codePrefix: "ARC",
    desc: "Spend in store or online. You save $3." },
  { id: "arc-gels", name: "Energy gel 6-pack", brand: "Austin Running Co.", price: 4, icon: "⚡", color: "#fef3c7", kind: "product", codePrefix: "GEL",
    desc: "Pick up at the store with your code." },
  { id: "peak-socks", name: "Performance socks", brand: "Peak Shoes", price: 6, icon: "🧦", color: "#ede9fe", kind: "product", codePrefix: "SOCK",
    desc: "Blister-free running socks, any size." },
  { id: "gold-name", name: "Gold runner badge", brand: "Lock&Run", price: 3, icon: "⭐", color: "#fef9c3", kind: "perk", codePrefix: "GOLD",
    desc: "A gold star next to your name in the app." },
  { id: "cap", name: "Lock&Run running cap", brand: "Lock&Run", price: 8, icon: "🧢", color: "#dcfce7", kind: "product", codePrefix: "CAP",
    desc: "Lightweight cap for race day. Pick up at the next meetup." },
];

export const shopItem = (id: string) => SHOP_ITEMS.find((i) => i.id === id);

export type Order = {
  id: string;
  itemId: string;
  address: string;
  price: number;
  status: "pending" | "paid";
  createdAt: number;
  paidAt?: number;
  sig?: string;
  code?: string;
  message?: string; // the exact transaction the server prepared (base64), so only that one can be submitted
};
