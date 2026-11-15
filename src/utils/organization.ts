import { OrganizationSettings } from '../types/inventory';

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  name: 'Telšių raj. Tryškių Lazdynų Pelėdos gimnazija',
  code: '190558117',
  address: 'Lazdynų Pelėdos g. 20, LT-88172 Tryškiai, Telšių r. sav.',
  directorTitle: 'Gimnazijos direktorius',
  directorName: '',
};

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
  usesFallbackCurrentOrg: boolean;
} {
  if (documentSnapshot) {
    return {
      organization: cloneOrganizationSettings(documentSnapshot),
      usesFallbackCurrentOrg: false,
    };
  }
  return {
    organization: cloneOrganizationSettings(currentSettings),
    usesFallbackCurrentOrg: isHistoricalCompletedDocument,
  };
}
