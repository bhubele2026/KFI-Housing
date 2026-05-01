import { createContext, useContext, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import {
  useListCustomers, getListCustomersQueryKey, useCreateCustomer, useUpdateCustomer, useDeleteCustomer,
  useListProperties, getListPropertiesQueryKey, useCreateProperty, useUpdateProperty, useDeleteProperty,
  useListLeases, getListLeasesQueryKey, useCreateLease, useUpdateLease, useDeleteLease,
  useListBeds, getListBedsQueryKey, useCreateBed, useUpdateBed, useDeleteBed,
  useListOccupants, getListOccupantsQueryKey, useCreateOccupant, useUpdateOccupant,
  useListUtilities, getListUtilitiesQueryKey, useCreateUtility, useUpdateUtility, useDeleteUtility,
  useResetToSampleData,
  useImportData,
} from "@workspace/api-client-react";
import {
  CustomerSchema, PropertySchema, LeaseSchema, BedSchema, OccupantSchema, UtilitySchema,
  type Customer, type Property, type Lease, type Bed, type Occupant, type Utility,
} from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

export const EXPORT_FORMAT_VERSION = 2;

export const ExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.string(),
  data: z.object({
    customers: z.array(CustomerSchema),
    properties: z.array(PropertySchema),
    leases: z.array(LeaseSchema),
    beds: z.array(BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
  }),
});
export type ExportPayload = z.infer<typeof ExportPayloadSchema>;
export type ExportData = ExportPayload["data"];

// ── v1 (pre-Customers) export support ───────────────────────────────────
// v1 files have no `customers` array and properties have no `customerId`.
// We accept them by auto-creating a single placeholder customer and
// assigning every imported property to it.
const LegacyPropertySchema = PropertySchema.omit({ customerId: true });
const LegacyExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(1),
  exportedAt: z.string(),
  data: z.object({
    properties: z.array(LegacyPropertySchema),
    leases: z.array(LeaseSchema),
    beds: z.array(BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
  }),
});

export const LEGACY_CUSTOMER_ID = "legacy-customer";
const LEGACY_CUSTOMER: Customer = {
  id: LEGACY_CUSTOMER_ID,
  name: "Legacy Properties",
  contactName: "",
  email: "",
  phone: "",
  notes:
    "Auto-created during import of an older backup that did not include customers. " +
    "Re-assign these properties to your real customers when you're ready.",
};

export class UnsupportedImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImportError";
  }
}

export interface ImportSummary {
  customers: number;
  properties: number;
  leases: number;
  beds: number;
  occupants: number;
  utilities: number;
}

export interface ImportPreview {
  data: ExportData;
  summary: ImportSummary;
  /** True when the file was a v1 backup and we auto-created a Legacy customer. */
  migratedFromV1: boolean;
}

// Strict shape check: only treat a value as a pre-validated ImportPreview when
// every documented field is present with the right type. This prevents arbitrary
// objects from bypassing schema validation in importData.
function isImportPreview(value: unknown): value is ImportPreview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.migratedFromV1 !== "boolean") return false;
  const summary = v.summary;
  if (typeof summary !== "object" || summary === null) return false;
  const s = summary as Record<string, unknown>;
  for (const k of ["customers", "properties", "leases", "beds", "occupants", "utilities"]) {
    if (typeof s[k] !== "number") return false;
  }
  const data = v.data;
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  for (const k of ["customers", "properties", "leases", "beds", "occupants", "utilities"]) {
    if (!Array.isArray(d[k])) return false;
  }
  return true;
}

/**
 * Validate a parsed JSON payload, optionally migrating an older v1 backup.
 * Throws {@link UnsupportedImportError} with a user-friendly message if the
 * file is unrecognized or from an unsupported future version.
 */
export function inspectImportPayload(payload: unknown): ImportPreview {
  // Try the current (v2) format first.
  const v2 = ExportPayloadSchema.safeParse(payload);
  if (v2.success) {
    const d = v2.data.data;
    return {
      data: d,
      migratedFromV1: false,
      summary: {
        customers: d.customers.length,
        properties: d.properties.length,
        leases: d.leases.length,
        beds: d.beds.length,
        occupants: d.occupants.length,
        utilities: d.utilities.length,
      },
    };
  }

  // Fall back to the v1 (pre-Customers) format and migrate it.
  const v1 = LegacyExportPayloadSchema.safeParse(payload);
  if (v1.success) {
    const old = v1.data.data;
    const migratedProperties: Property[] = old.properties.map((p) => ({
      ...p,
      customerId: LEGACY_CUSTOMER_ID,
    }));
    const data: ExportData = {
      customers: [LEGACY_CUSTOMER],
      properties: migratedProperties,
      leases: old.leases,
      beds: old.beds,
      occupants: old.occupants,
      utilities: old.utilities,
    };
    return {
      data,
      migratedFromV1: true,
      summary: {
        customers: 1,
        properties: data.properties.length,
        leases: data.leases.length,
        beds: data.beds.length,
        occupants: data.occupants.length,
        utilities: data.utilities.length,
      },
    };
  }

  // Couldn't parse as either version — produce a tailored message.
  const obj =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const format = obj?.format;
  const version = obj?.version;
  if (format !== "housingops-export") {
    throw new UnsupportedImportError(
      "That file doesn't look like a HousingOps export. No changes were made.",
    );
  }
  if (typeof version === "number" && version > EXPORT_FORMAT_VERSION) {
    throw new UnsupportedImportError(
      `This backup uses a newer format (v${version}) than this app supports ` +
        `(v${EXPORT_FORMAT_VERSION}). Please update HousingOps and try again.`,
    );
  }
  throw new UnsupportedImportError(
    "This HousingOps backup is missing required fields and can't be imported.",
  );
}

export class CustomerInUseError extends Error {
  constructor() {
    super("Customer still owns properties.");
    this.name = "CustomerInUseError";
  }
}

interface DataStore {
  customers: Customer[];
  properties: Property[];
  leases: Lease[];
  beds: Bed[];
  occupants: Occupant[];
  utilities: Utility[];
  isLoading: boolean;
  addCustomer: (customer: Customer) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  deleteCustomer: (id: string) => Promise<void>;
  addProperty: (property: Property) => Promise<Property>;
  updateProperty: (id: string, updates: Partial<Property>) => void;
  deleteProperty: (id: string) => void;
  updateLease: (id: string, updates: Partial<Lease>) => void;
  addLease: (lease: Lease) => void;
  deleteLease: (id: string) => void;
  addBed: (bed: Bed) => void;
  deleteBed: (id: string) => void;
  updateBed: (id: string, updates: Partial<Bed>) => void;
  updateOccupant: (id: string, updates: Partial<Occupant>) => void;
  addOccupant: (occupant: Occupant) => void;
  updateUtility: (id: string, updates: Partial<Utility>) => void;
  addUtility: (utility: Utility) => void;
  deleteUtility: (id: string) => void;
  resetToSampleData: () => void;
  exportData: () => ExportPayload;
  importData: (input: unknown | ImportPreview) => ImportSummary;
}

const DataContext = createContext<DataStore | undefined>(undefined);

const EMPTY: never[] = [];

export function DataProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const notifySaveError = (action: string) => {
    toast({
      title: "Save failed",
      description: `Couldn't ${action}. Your change was reverted. Please check your connection and try again.`,
      variant: "destructive",
    });
  };

  const customersQuery = useListCustomers();
  const propertiesQuery = useListProperties();
  const leasesQuery = useListLeases();
  const bedsQuery = useListBeds();
  const occupantsQuery = useListOccupants();
  const utilitiesQuery = useListUtilities();

  const customersKey = getListCustomersQueryKey();
  const propertiesKey = getListPropertiesQueryKey();
  const leasesKey = getListLeasesQueryKey();
  const bedsKey = getListBedsQueryKey();
  const occupantsKey = getListOccupantsQueryKey();
  const utilitiesKey = getListUtilitiesQueryKey();

  const createCustomerMut = useCreateCustomer();
  const updateCustomerMut = useUpdateCustomer();
  const deleteCustomerMut = useDeleteCustomer();
  const createPropertyMut = useCreateProperty();
  const updatePropertyMut = useUpdateProperty();
  const deletePropertyMut = useDeleteProperty();
  const createLeaseMut = useCreateLease();
  const updateLeaseMut = useUpdateLease();
  const deleteLeaseMut = useDeleteLease();
  const createBedMut = useCreateBed();
  const updateBedMut = useUpdateBed();
  const deleteBedMut = useDeleteBed();
  const createOccupantMut = useCreateOccupant();
  const updateOccupantMut = useUpdateOccupant();
  const createUtilityMut = useCreateUtility();
  const updateUtilityMut = useUpdateUtility();
  const deleteUtilityMut = useDeleteUtility();
  const resetMut = useResetToSampleData();
  const importMut = useImportData();

  const customers = (customersQuery.data as Customer[] | undefined) ?? EMPTY;
  const properties = (propertiesQuery.data as Property[] | undefined) ?? EMPTY;
  const leases = (leasesQuery.data as Lease[] | undefined) ?? EMPTY;
  const beds = (bedsQuery.data as Bed[] | undefined) ?? EMPTY;
  const occupants = (occupantsQuery.data as Occupant[] | undefined) ?? EMPTY;
  const utilities = (utilitiesQuery.data as Utility[] | undefined) ?? EMPTY;

  const isLoading =
    customersQuery.isLoading ||
    propertiesQuery.isLoading ||
    leasesQuery.isLoading ||
    bedsQuery.isLoading ||
    occupantsQuery.isLoading ||
    utilitiesQuery.isLoading;

  // ── Helpers for optimistic cache updates ────────────────────────────────
  function patchInList<T extends { id: string }>(
    key: QueryKey,
    id: string,
    updates: Partial<T>,
  ) {
    queryClient.setQueryData<T[]>(key, (prev) =>
      prev ? prev.map((item) => (item.id === id ? { ...item, ...updates } : item)) : prev,
    );
  }
  function pushToList<T>(key: QueryKey, item: T) {
    queryClient.setQueryData<T[]>(key, (prev) => (prev ? [...prev, item] : [item]));
  }
  function removeFromList<T extends { id: string }>(key: QueryKey, id: string) {
    queryClient.setQueryData<T[]>(key, (prev) =>
      prev ? prev.filter((item) => item.id !== id) : prev,
    );
  }

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: customersKey });
    queryClient.invalidateQueries({ queryKey: propertiesKey });
    queryClient.invalidateQueries({ queryKey: leasesKey });
    queryClient.invalidateQueries({ queryKey: bedsKey });
    queryClient.invalidateQueries({ queryKey: occupantsKey });
    queryClient.invalidateQueries({ queryKey: utilitiesKey });
  };

  // ── Customer mutations ──────────────────────────────────────────────────
  // Returns a promise so callers (e.g. inline customer-create from the Add
  // Property dialog) can await persistence before creating dependent rows.
  const addCustomer = async (customer: Customer): Promise<Customer> => {
    pushToList<Customer>(customersKey, customer);
    try {
      const saved = await createCustomerMut.mutateAsync({ data: customer });
      return saved as Customer;
    } catch (err) {
      // Roll back the optimistic insert and rethrow for the caller to surface.
      removeFromList<Customer>(customersKey, customer.id);
      throw err;
    } finally {
      queryClient.invalidateQueries({ queryKey: customersKey });
    }
  };
  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    patchInList<Customer>(customersKey, id, updates);
    updateCustomerMut.mutate(
      { id, data: updates },
      { onSettled: () => queryClient.invalidateQueries({ queryKey: customersKey }) },
    );
  };
  const deleteCustomer = async (id: string): Promise<void> => {
    // Guard: refuse if any property still references this customer.
    const hasProperty = properties.some((p) => p.customerId === id);
    if (hasProperty) {
      throw new CustomerInUseError();
    }
    return new Promise<void>((resolve, reject) => {
      deleteCustomerMut.mutate(
        { id },
        {
          onSuccess: () => {
            removeFromList<Customer>(customersKey, id);
            resolve();
          },
          onError: (err: unknown) => {
            const status = (err as { status?: number } | undefined)?.status;
            if (status === 409) reject(new CustomerInUseError());
            else reject(err);
          },
          onSettled: () => queryClient.invalidateQueries({ queryKey: customersKey }),
        },
      );
    });
  };

  // ── Property mutations (optimistic; refetch on settle) ──────────────────
  // Returns a promise so callers can await server validation (e.g. customerId
  // foreign-key check) before showing a success toast.
  const addProperty = async (property: Property): Promise<Property> => {
    pushToList<Property>(propertiesKey, property);
    try {
      const saved = await createPropertyMut.mutateAsync({ data: property });
      return saved as Property;
    } catch (err) {
      removeFromList<Property>(propertiesKey, property.id);
      throw err;
    } finally {
      queryClient.invalidateQueries({ queryKey: propertiesKey });
    }
  };
  const updateProperty = (id: string, updates: Partial<Property>) => {
    patchInList<Property>(propertiesKey, id, updates);
    updatePropertyMut.mutate(
      { id, data: updates },
      {
        onError: () => notifySaveError("save your property changes"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: propertiesKey }),
      },
    );
  };
  const deleteProperty = (id: string) => {
    removeFromList<Property>(propertiesKey, id);
    deletePropertyMut.mutate(
      { id },
      { onSettled: () => queryClient.invalidateQueries({ queryKey: propertiesKey }) },
    );
  };

  const updateLease = (id: string, updates: Partial<Lease>) => {
    patchInList<Lease>(leasesKey, id, updates);
    updateLeaseMut.mutate(
      { id, data: updates },
      {
        onError: () => notifySaveError("save your lease changes"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: leasesKey }),
      },
    );
  };
  const addLease = (lease: Lease) => {
    pushToList<Lease>(leasesKey, lease);
    createLeaseMut.mutate(
      { data: lease },
      {
        onError: () => notifySaveError("add the new lease"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: leasesKey }),
      },
    );
  };
  const deleteLease = (id: string) => {
    removeFromList<Lease>(leasesKey, id);
    deleteLeaseMut.mutate(
      { id },
      {
        onError: () => notifySaveError("delete the lease"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: leasesKey }),
      },
    );
  };

  const addBed = (bed: Bed) => {
    pushToList<Bed>(bedsKey, bed);
    createBedMut.mutate(
      { data: bed },
      {
        onError: () => notifySaveError("add the new bed"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: bedsKey }),
      },
    );
  };
  const deleteBed = (id: string) => {
    removeFromList<Bed>(bedsKey, id);
    deleteBedMut.mutate(
      { id },
      {
        onError: () => notifySaveError("delete the bed"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: bedsKey }),
      },
    );
  };
  const updateBed = (id: string, updates: Partial<Bed>) => {
    patchInList<Bed>(bedsKey, id, updates);
    updateBedMut.mutate(
      { id, data: updates },
      {
        onError: () => notifySaveError("save your bed changes"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: bedsKey }),
      },
    );
  };

  const updateOccupant = (id: string, updates: Partial<Occupant>) => {
    patchInList<Occupant>(occupantsKey, id, updates);
    updateOccupantMut.mutate(
      { id, data: updates },
      {
        onError: () => notifySaveError("save your occupant changes"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: occupantsKey }),
      },
    );
  };
  const addOccupant = (occupant: Occupant) => {
    pushToList<Occupant>(occupantsKey, occupant);
    createOccupantMut.mutate(
      { data: occupant },
      {
        onError: () => notifySaveError("add the new occupant"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: occupantsKey }),
      },
    );
  };

  const updateUtility = (id: string, updates: Partial<Utility>) => {
    patchInList<Utility>(utilitiesKey, id, updates);
    updateUtilityMut.mutate(
      { id, data: updates },
      {
        onError: () => notifySaveError("save your utility changes"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: utilitiesKey }),
      },
    );
  };
  const addUtility = (utility: Utility) => {
    pushToList<Utility>(utilitiesKey, utility);
    createUtilityMut.mutate(
      { data: utility },
      {
        onError: () => notifySaveError("add the new utility"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: utilitiesKey }),
      },
    );
  };
  const deleteUtility = (id: string) => {
    removeFromList<Utility>(utilitiesKey, id);
    deleteUtilityMut.mutate(
      { id },
      {
        onError: () => notifySaveError("delete the utility"),
        onSettled: () => queryClient.invalidateQueries({ queryKey: utilitiesKey }),
      },
    );
  };

  const resetToSampleData = () => {
    resetMut.mutate(undefined, {
      onError: () => notifySaveError("reset to sample data"),
      onSettled: invalidateAll,
    });
  };

  const exportData = (): ExportPayload => ({
    format: "housingops-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data: { customers, properties, leases, beds, occupants, utilities },
  });

  // Accepts either a raw parsed JSON payload (which we'll inspect ourselves)
  // or a pre-validated ImportPreview (so callers that already inspected the
  // file — e.g. to show a tailored confirmation dialog — don't pay to parse
  // it twice). Throws UnsupportedImportError for unrecognized payloads.
  const importData = (input: unknown): ImportSummary => {
    const preview =
      isImportPreview(input) ? input : inspectImportPayload(input);
    const { data } = preview;

    // Optimistically populate caches so the UI reflects the import immediately.
    queryClient.setQueryData<Customer[]>(customersKey, data.customers);
    queryClient.setQueryData<Property[]>(propertiesKey, data.properties);
    queryClient.setQueryData<Lease[]>(leasesKey, data.leases);
    queryClient.setQueryData<Bed[]>(bedsKey, data.beds);
    queryClient.setQueryData<Occupant[]>(occupantsKey, data.occupants);
    queryClient.setQueryData<Utility[]>(utilitiesKey, data.utilities);

    // Persist atomically on the server, then re-fetch to confirm.
    importMut.mutate(
      { data },
      {
        onError: () => notifySaveError("save the imported data"),
        onSettled: invalidateAll,
      },
    );

    return preview.summary;
  };

  return (
    <DataContext.Provider value={{
      customers, properties, leases, beds, occupants, utilities, isLoading,
      addCustomer, updateCustomer, deleteCustomer,
      addProperty, updateProperty, deleteProperty,
      updateLease, addLease, deleteLease,
      addBed, deleteBed, updateBed, updateOccupant, addOccupant,
      updateUtility, addUtility, deleteUtility,
      resetToSampleData, exportData, importData,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
