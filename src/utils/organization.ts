import { OrganizationSettings } from '../types/inventory';

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  name: 'Telšių raj. Tryškių Lazdynų Pelėdos gimnazija',
  code: '190558117',
  address: 'Lazdynų Pelėdos g. 20, LT-88172 Tryškiai, Telšių r. sav.',
  directorTitle: 'Gimnazijos direktorius',
  directorName: '',
};

export const UNCONFIRMED_ORGANIZATION_PLACEHOLDER: OrganizationSettings = {
  name: 'Įstaigos rekvizitai nepatvirtinti',
  code: 'Nenurodytas',
  address: 'Nenurodytas',
  directorTitle: 'Įstaigos vadovas',
  directorName: '',
};

export function hasConfirmedOrganizationSettings(
  settings?: Partial<OrganizationSettings> | null
): settings is OrganizationSettings {
  if (!settings) return false;
  const name = settings.name?.trim() || '';
  const code = settings.code?.trim() || '';
  const address = settings.address?.trim() || '';
  const directorTitle = settings.directorTitle?.trim() || '';
  if (!name || !code || !address || !directorTitle) return false;
  if (name === UNCONFIRMED_ORGANIZATION_PLACEHOLDER.name) return false;
  return true;
}

export function cloneOrganizationSettings(
  settings?: Partial<OrganizationSettings> | null
): OrganizationSettings {
  const name = settings?.name?.trim() || DEFAULT_ORGANIZATION_SETTINGS.name;
  const code = settings?.code?.trim() || DEFAULT_ORGANIZATION_SETTINGS.code;
  const address = settings?.address?.trim() || DEFAULT_ORGANIZATION_SETTINGS.address;
  const directorTitle =
    settings?.directorTitle?.trim() || DEFAULT_ORGANIZATION_SETTINGS.directorTitle;
  const directorName = settings?.directorName?.trim() || '';
  return {
    name,
    code,
    address,
    directorTitle,
    ...(directorName ? { directorName } : {}),
  };
}

export function resolveOrganizationForDocument(
  documentSnapshot: OrganizationSettings | undefined,
  currentSettings: OrganizationSettings | undefined,
  isHistoricalCompletedDocument: boolean
): {
  organization: OrganizationSettings;
  hasConfirmedOrganization: boolean;
  usesFallbackCurrentOrg: boolean;
} {
  if (hasConfirmedOrganizationSettings(documentSnapshot)) {
    return {
      organization: cloneOrganizationSettings(documentSnapshot),
      hasConfirmedOrganization: true,
      usesFallbackCurrentOrg: false,
    };
  }
  if (hasConfirmedOrganizationSettings(currentSettings)) {
    return {
      organization: cloneOrganizationSettings(currentSettings),
      hasConfirmedOrganization: true,
      usesFallbackCurrentOrg: isHistoricalCompletedDocument,
    };
  }
  return {
    organization: { ...UNCONFIRMED_ORGANIZATION_PLACEHOLDER },
    hasConfirmedOrganization: false,
    usesFallbackCurrentOrg: false,
  };
}
