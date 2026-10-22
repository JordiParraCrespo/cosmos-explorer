"use client";

import type { ReactNode } from "react";
import { ErrorBoundary, ErrorState } from "@cosmos-explorer/ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@cosmos-explorer/ui/card";

// Keeps a failing votes query from taking down the whole proposal page.
export function ProposalVotesErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <Card>
          <CardHeader>
            <CardTitle>Votes</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorState message="Votes are temporarily unavailable." />
          </CardContent>
        </Card>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
