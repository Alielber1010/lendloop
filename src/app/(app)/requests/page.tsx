"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { LoanList } from "@/components/LoanCard";

export default function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">My requests</h1>
          <p className="muted">Things you&apos;ve asked to borrow.</p>
        </div>
      </div>
      <LoanList loans={loans} as="borrower" empty="No requests yet. Find something on the board." />
    </>
  );
}
