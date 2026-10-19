import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full platform access; granted every seeded permission as baseline.',
  },
  {
    code: 'SYSTEM_AUDITOR',
    name: 'System Auditor',
    description: 'Read-only oversight role; no elevated permissions seeded in G0.',
  },
  {
    code: 'MODERATOR',
    name: 'Moderator',
    description: 'Catalog/content moderation; permissions land with G2.',
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    description: 'Finance approvals; permissions land with G5.',
  },
  {
    code: 'SUPPORT_AGENT',
    name: 'Support Agent',
    description:
      'Customer support; deliberately excluded from test:read so T-G0-5 can assert a 403.',
  },
] as const;

const ADMIN_PERMISSIONS = [
  { resource: 'test', action: 'read' },
  // T-G1-1: seeded ahead of T-G1-5's moderation/suspension behavior so that
  // ticket can wire real endpoints against an already-existing grant
  // mechanism instead of inventing a second one.
  { resource: 'seller', action: 'moderate' },
  { resource: 'seller', action: 'suspend' },
  // T-G2-1: the four catalog/offers admin codes frozen by
  // docs/architecture/api-contract-g2.md's permission-code table (2-segment
  // resource:action, superseding T-G2-1's own 3-segment ticket-text
  // proposal — see that doc's "Inconsistencies resolved" #1).
  { resource: 'category', action: 'manage' },
  { resource: 'catalog', action: 'moderate' },
  { resource: 'merge_case', action: 'approve' },
  { resource: 'offers', action: 'moderate' },
] as const;

// seller:suspend is deliberately NOT granted to MODERATOR here — TZ never
// names which role may suspend an already-ACTIVE seller (a more sensitive
// action than reviewing a new application), so T-G1-1's seed grants it only
// to SUPER_ADMIN as the narrowest safe default (docs/open-questions.md #28).
// Reassignable later via admin_role_permissions with no code change.
//
// T-G2-1's four new codes follow the same baseline convention: SUPER_ADMIN
// gets every seeded permission (per ADMIN_ROLES' own description above),
// MODERATOR additionally gets only catalog:moderate/offers:moderate (the
// review grants) — category:manage (taxonomy authoring) and
// merge_case:approve stay SUPER_ADMIN-only, same narrowest-safe-default
// reasoning as seller:suspend (TZ never names who manages categories or
// approves merges either).
const ROLE_PERMISSION_GRANTS: ReadonlyArray<{
  roleCode: string;
  resource: string;
  action: string;
}> = [
  { roleCode: 'SUPER_ADMIN', resource: 'test', action: 'read' },
  { roleCode: 'SUPER_ADMIN', resource: 'seller', action: 'moderate' },
  { roleCode: 'SUPER_ADMIN', resource: 'seller', action: 'suspend' },
  { roleCode: 'SUPER_ADMIN', resource: 'category', action: 'manage' },
  { roleCode: 'SUPER_ADMIN', resource: 'catalog', action: 'moderate' },
  { roleCode: 'SUPER_ADMIN', resource: 'merge_case', action: 'approve' },
  { roleCode: 'SUPER_ADMIN', resource: 'offers', action: 'moderate' },
  { roleCode: 'MODERATOR', resource: 'seller', action: 'moderate' },
  { roleCode: 'MODERATOR', resource: 'catalog', action: 'moderate' },
  { roleCode: 'MODERATOR', resource: 'offers', action: 'moderate' },
];

const ADMIN_MEMBERS = [
  { phone: '+998900000001', roleCode: 'SUPER_ADMIN' },
  { phone: '+998900000002', roleCode: 'SUPPORT_AGENT' },
  { phone: '+998900000003', roleCode: 'SYSTEM_AUDITOR' },
  // T-G1-1: G1's moderation ticket (T-G1-5) needs a seeded MODERATOR to test
  // seller:moderate against — G0 only ever seeded SUPER_ADMIN/SUPPORT_AGENT/
  // SYSTEM_AUDITOR even though the MODERATOR role itself already existed.
  { phone: '+998900000004', roleCode: 'MODERATOR' },
] as const;

const SAMPLE_CUSTOMERS = ['+998901000001', '+998901000002'] as const;

// T-G2-1: 2 nested categories (parent + child), each carrying its own 1
// required + 1 optional category_attributes row, as fixtures later G2
// tickets' tests reuse. The "color"/ENUM example matches
// docs/architecture/api-contract-g2.md's own T-G2-2 response example
// verbatim, to minimize drift between this fixture and that doc's examples.
const CATEGORY_FIXTURES = {
  parent: { slug: 'electronics', name: 'Electronics' },
  child: { slug: 'electronics-phones', name: 'Phones' },
} as const;

const CATEGORY_ATTRIBUTE_FIXTURES: ReadonlyArray<{
  categorySlug: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  validation: unknown;
}> = [
  {
    categorySlug: 'electronics',
    key: 'warranty_months',
    label: 'Warranty (months)',
    type: 'NUMERIC_RANGE',
    required: true,
    validation: { min: 0, max: 60 },
  },
  {
    categorySlug: 'electronics',
    key: 'country_of_origin',
    label: 'Country of Origin',
    type: 'TEXT',
    required: false,
    validation: null,
  },
  {
    categorySlug: 'electronics-phones',
    key: 'color',
    label: 'Color',
    type: 'ENUM',
    required: true,
    validation: { enum_values: ['red', 'blue'] },
  },
  {
    categorySlug: 'electronics-phones',
    key: 'storage_gb',
    label: 'Storage (GB)',
    type: 'NUMERIC_RANGE',
    required: false,
    validation: { min: 16, max: 1024 },
  },
];

async function main() {
  const roleIdByCode = new Map<string, string>();
  for (const role of ADMIN_ROLES) {
    const row = await prisma.adminRole.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: { code: role.code, name: role.name, description: role.description },
    });
    roleIdByCode.set(role.code, row.id);
  }

  const permissionIdByKey = new Map<string, string>();
  for (const permission of ADMIN_PERMISSIONS) {
    const row = await prisma.adminPermission.upsert({
      where: { resource_action: { resource: permission.resource, action: permission.action } },
      update: {},
      create: { resource: permission.resource, action: permission.action },
    });
    permissionIdByKey.set(`${permission.resource}:${permission.action}`, row.id);
  }

  for (const grant of ROLE_PERMISSION_GRANTS) {
    const roleId = roleIdByCode.get(grant.roleCode);
    const permissionId = permissionIdByKey.get(`${grant.resource}:${grant.action}`);
    if (!roleId || !permissionId) {
      throw new Error(
        `seed: role ${grant.roleCode} or permission ${grant.resource}:${grant.action} failed to upsert`,
      );
    }
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
  }

  for (const member of ADMIN_MEMBERS) {
    const user = await prisma.user.upsert({
      where: { phone: member.phone },
      update: {},
      create: { phone: member.phone, phoneVerifiedAt: new Date('2026-01-01T00:00:00Z') },
    });
    const roleId = roleIdByCode.get(member.roleCode);
    if (!roleId) {
      throw new Error(`seed: role ${member.roleCode} failed to upsert`);
    }
    await prisma.adminMember.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
  }

  for (const phone of SAMPLE_CUSTOMERS) {
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });
  }

  const parentCategory = await prisma.category.upsert({
    where: { slug: CATEGORY_FIXTURES.parent.slug },
    update: {},
    create: { slug: CATEGORY_FIXTURES.parent.slug, name: CATEGORY_FIXTURES.parent.name },
  });
  const childCategory = await prisma.category.upsert({
    where: { slug: CATEGORY_FIXTURES.child.slug },
    update: {},
    create: {
      slug: CATEGORY_FIXTURES.child.slug,
      name: CATEGORY_FIXTURES.child.name,
      parentId: parentCategory.id,
    },
  });
  const categoryIdBySlug = new Map<string, string>([
    [CATEGORY_FIXTURES.parent.slug, parentCategory.id],
    [CATEGORY_FIXTURES.child.slug, childCategory.id],
  ]);

  for (const attribute of CATEGORY_ATTRIBUTE_FIXTURES) {
    const categoryId = categoryIdBySlug.get(attribute.categorySlug);
    if (!categoryId) {
      throw new Error(`seed: category ${attribute.categorySlug} failed to upsert`);
    }
    await prisma.categoryAttribute.upsert({
      where: { categoryId_key: { categoryId, key: attribute.key } },
      update: {},
      create: {
        categoryId,
        key: attribute.key,
        label: attribute.label,
        type: attribute.type,
        required: attribute.required,
        validation:
          attribute.validation === null
            ? Prisma.DbNull
            : (attribute.validation as Prisma.InputJsonValue),
      },
    });
  }
}

main()
  .catch((error) => {
    console.error('seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
