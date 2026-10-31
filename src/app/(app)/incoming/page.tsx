"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { LoanList } from "@/components/LoanCard";

export default function IncomingRequests() {
  const loans = useQuery(api.loans.incoming);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">Incoming requests</h1>
          <p className="muted">Neighbours asking to borrow your tools.</p>
        </div>
      </div>
      <LoanList loans={loans} as="lender" empty="No one has asked to borrow your tools yet." />
    </>
  );
}
