import CreateClient from "./CreateClient";

export const metadata = {
  title: "Create",
  // Spike: keep out of search results until this is a real feature.
  robots: { index: false },
};

export default function CreatePage() {
  return <CreateClient />;
}
