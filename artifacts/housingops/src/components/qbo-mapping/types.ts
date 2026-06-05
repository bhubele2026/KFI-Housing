export interface CustomerLink {
  customerId: string;
  customerName: string;
  qboCustomerId: string | null;
}

export interface MemoRule {
  id: string;
  realmId: string;
  qboCustomerId: string;
  qboVendorId: string;
  memoToken: string;
  propertyId: string;
  leaseId: string | null;
  utilityId: string | null;
  matchCount?: number;
  createdAt?: string | null;
}

export interface AccountClassification {
  id: string;
  qboAccountId: string;
  accountName: string;
  classification: "rent" | "utility" | "other";
}

export interface MappingRulesPayload {
  realmId: string | null;
  customerLinks: CustomerLink[];
  memoRules: MemoRule[];
  accountClassifications: AccountClassification[];
}

export interface UnlinkedQboCustomer {
  id: string;
  displayName: string;
}
