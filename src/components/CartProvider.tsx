import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

const cartLineSchema = Schema.Struct({
  productId: Schema.String,
  variantId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  quantity: Schema.Number.pipe(Schema.int(), Schema.between(1, 20)),
});
export type CartLine = Schema.Schema.Type<typeof cartLineSchema>;
const decodeCart = Schema.decodeUnknownSync(
  Schema.Array(cartLineSchema).pipe(
    Schema.maxItems(12),
    Schema.filter((lines) => lines.reduce((total, line) => total + line.quantity, 0) <= 50),
  ),
);
const CartContext = createContext<{
  cart: CartLine[];
  setCart: Dispatch<SetStateAction<CartLine[]>>;
  cartLoaded: boolean;
} | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("utxowear-cart") ?? "[]");
      setCart([...decodeCart(saved)]);
    } catch {
      // Invalid or unavailable storage starts with an empty in-memory bag.
    }
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    if (!cartLoaded) return;
    try {
      localStorage.setItem("utxowear-cart", JSON.stringify(cart));
    } catch {
      // The in-memory bag remains usable when storage is disabled.
    }
  }, [cart, cartLoaded]);

  useEffect(() => {
    if (pathname === "/cart" && new URLSearchParams(searchStr).get("checkout") === "success")
      setCart([]);
  }, [pathname, searchStr]);

  return <CartContext value={{ cart, setCart, cartLoaded }}>{children}</CartContext>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("Cart components require CartProvider.");
  return context;
}
