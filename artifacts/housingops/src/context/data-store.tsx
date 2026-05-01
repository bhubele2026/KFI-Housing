import { createContext, useContext, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import {
  useListProperties, getListPropertiesQueryKey, useUpdateProperty,
  useListLeases, getListLeasesQueryKey, useCreateLease, useUpdateLease, useDeleteLease,
  useListBeds, getListBedsQueryKey, useCreateBed, useUpdateBed, useDeleteBed,
  useListOccupants, getListOccupantsQueryKey, useCreateOccupant, useUpdateOccupant,
  useListUtilities, getListUtilitiesQueryKey, useCreateUtility, useUpdateUtility, useDeleteUtility,
  useResetToSampleData,
  useImportData,
} from "@workspace/api-client-react";
import {
  PropertySchema, LeaseSchema, BedSchema, OccupantSchema, UtilitySchema,
  type Property, type Lease, type Bed, type Occupant, type Utility,
} from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

export const EXPORT_FORMAT_VERSION = 1;

export const ExportPayloadSchema = z.object({
  format: z.literal("housingops-export"),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.string(),
  data: z.object({
    properties: z.array(PropertySchema),
    leases: z.array(LeaseSchema),
    beds: z.array(BedSchema),
    occupants: z.array(OccupantSchema),
    utilities: z.array(UtilitySchema),
  }),
});
export type ExportPayload = z.infer<typeof ExportPayloadSchema>;

export interface ImportSummary {
  properties: number;
  leases: number;
  beds: number;
  occupants: number;
  utilities: number;
}

interface DataStore {
  properties: Property[];
  leases: Lease[];
  beds: Bed[];
  occupants: Occupant[];
  utilities: Utility[];
  isLoading: boolean;
  updateProperty: (id: string, updates: Partial<Property>) => void;
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
  importData: (payload: unknown) => ImportSummary;
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

  const propertiesQuery = useListProperties();
  const leasesQuery = useListLeases();
  const bedsQuery = useListBeds();
  const occupantsQuery = useListOccupants();
  const utilitiesQuery = useListUtilities();

  const propertiesKey = getListPropertiesQueryKey();
  const leasesKey = getListLeasesQueryKey();
  const bedsKey = getListBedsQueryKey();
  const occupantsKey = getListOccupantsQueryKey();
  const utilitiesKey = getListUtilitiesQueryKey();

  const updatePropertyMut = useUpdateProperty();
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

  const properties = (propertiesQuery.data as Property[] | undefined) ?? EMPTY;
  const leases = (leasesQuery.data as Lease[] | undefined) ?? EMPTY;
  const beds = (bedsQuery.data as Bed[] | undefined) ?? EMPTY;
  const occupants = (occupantsQuery.data as Occupant[] | undefined) ?? EMPTY;
  const utilities = (utilitiesQuery.data as Utility[] | undefined) ?? EMPTY;

  const isLoading =
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
    queryClient.invalidateQueries({ queryKey: propertiesKey });
    queryClient.invalidateQueries({ queryKey: leasesKey });
    queryClient.invalidateQueries({ queryKey: bedsKey });
    queryClient.invalidateQueries({ queryKey: occupantsKey });
    queryClient.invalidateQueries({ queryKey: utilitiesKey });
  };

  // ── Mutations (optimistic; refetch on settle) ───────────────────────────
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
    data: { properties, leases, beds, occupants, utilities },
  });

  const importData = (payload: unknown): ImportSummary => {
    const parsed = ExportPayloadSchema.parse(payload);
    const { data } = parsed;

    // Optimistically populate caches so the UI reflects the import immediately.
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

    return {
      properties: data.properties.length,
      leases: data.leases.length,
      beds: data.beds.length,
      occupants: data.occupants.length,
      utilities: data.utilities.length,
    };
  };

  return (
    <DataContext.Provider value={{
      properties, leases, beds, occupants, utilities, isLoading,
      updateProperty, updateLease, addLease, deleteLease,
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
