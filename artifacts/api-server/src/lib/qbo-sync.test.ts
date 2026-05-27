import { describe, expect, it } from "vitest";
import { extractLinkedTxnRefs, inheritFromLinked } from "./qbo-sync";

describe("extractLinkedTxnRefs", () => {
  it("pulls invoice + bill ids out of Payment.Line[].LinkedTxn", () => {
    const refs = extractLinkedTxnRefs({
      Line: [
        {
          LinkedTxn: [
            { TxnId: "1001", TxnType: "Invoice" },
            { TxnId: "2002", TxnType: "Bill" },
          ],
        },
        { LinkedTxn: [{ TxnId: "3003", TxnType: "VendorCredit" }] },
      ],
    });
    expect(refs).toEqual([
      { qboType: "invoice", qboId: "1001" },
      { qboType: "bill", qboId: "2002" },
      { qboType: "bill", qboId: "3003" },
    ]);
  });

  it("returns [] when no line items carry a LinkedTxn", () => {
    expect(extractLinkedTxnRefs({ Line: [{ Description: "Rent" }] })).toEqual([]);
  });

  it("skips entries with a missing TxnId", () => {
    const refs = extractLinkedTxnRefs({
      Line: [{ LinkedTxn: [{ TxnType: "Invoice" }] }],
    });
    expect(refs).toEqual([]);
  });
});

describe("inheritFromLinked", () => {
  it("returns null for an empty link set", () => {
    expect(inheritFromLinked([])).toBeNull();
  });

  it("inherits classification + property/lease from the single linked invoice", () => {
    const r = inheritFromLinked([
      {
        classification: "rent",
        propertyId: "prop-1",
        leaseId: "lease-1",
        utilityId: null,
        customerId: "cust-1",
        amount: 1500,
      },
    ]);
    expect(r).toEqual({
      classification: "rent",
      propertyId: "prop-1",
      leaseId: "lease-1",
      utilityId: null,
      customerId: "cust-1",
    });
  });

  it("classification with the largest absolute amount wins for split payments", () => {
    const r = inheritFromLinked([
      {
        classification: "utility",
        propertyId: "prop-1",
        leaseId: null,
        utilityId: "u-1",
        customerId: "cust-1",
        amount: 80,
      },
      {
        classification: "rent",
        propertyId: "prop-1",
        leaseId: "lease-1",
        utilityId: null,
        customerId: "cust-1",
        amount: 1500,
      },
    ]);
    expect(r?.classification).toBe("rent");
    expect(r?.leaseId).toBe("lease-1");
  });

  it("never picks a property/lease from a row whose classification lost the tally", () => {
    const r = inheritFromLinked([
      {
        classification: "other",
        propertyId: "prop-X",
        leaseId: null,
        utilityId: null,
        customerId: null,
        amount: 5000,
      },
      {
        classification: "rent",
        propertyId: "prop-Y",
        leaseId: "lease-Y",
        utilityId: null,
        customerId: "cust-Y",
        amount: 1500,
      },
      {
        classification: "rent",
        propertyId: "prop-Z",
        leaseId: "lease-Z",
        utilityId: null,
        customerId: "cust-Z",
        amount: 800,
      },
    ]);
    expect(r?.classification).toBe("other");
    expect(r?.propertyId).toBe("prop-X");
  });
});
