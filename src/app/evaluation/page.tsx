import type { Metadata } from "next";
import { EvaluationView } from "@/components/evaluation/EvaluationView";

export const metadata: Metadata = {
  title: "Controller Evaluation — Nimbus",
  description:
    "Compare the Naive, Reactive, and Nimbus controllers on identical simulated scenarios using real evaluation metrics from the Nimbus simulation API.",
};

export default function EvaluationPage() {
  return <EvaluationView />;
}
