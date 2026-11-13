import { createFileRoute } from "@tanstack/react-router";
import ProductList from "../components/ProductList";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <section id="shop" aria-label="Products">
      <ProductList />
    </section>
  );
}
