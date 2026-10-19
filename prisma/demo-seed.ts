// Demo/staging-only content for the live Fly.io deploy so the buyer web app has
// real published products to render, not an empty catalog. Not part of
// `pnpm db:seed` (which seeds only RBAC/category fixtures every environment
// needs) — run explicitly via `pnpm db:demo-seed`, intended for the staging
// deploy, not local dev or CI.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phones = await prisma.category.findFirstOrThrow({ where: { slug: 'electronics-phones' } });

  const seller =
    (await prisma.seller.findFirst({ where: { taxId: '123456789' } })) ??
    (await prisma.seller.create({
      data: {
        legalName: 'Demo Electronics MChJ',
        taxId: '123456789',
        legalType: 'MCHJ',
        displayName: 'Demo Electronics',
        status: 'ACTIVE',
      },
    }));

  const demoProducts = [
    { title: 'Smartphone Alpha 128GB', sku: 'ALPHA-128-BLK', priceMinor: 450000000n, options: { color: 'black', storage: '128GB' } },
    { title: 'Smartphone Alpha 256GB', sku: 'ALPHA-256-BLU', priceMinor: 520000000n, options: { color: 'blue', storage: '256GB' } },
    { title: 'Smartphone Nova Lite', sku: 'NOVA-LITE-WHT', priceMinor: 280000000n, options: { color: 'white', storage: '64GB' } },
  ];

  for (const demo of demoProducts) {
    const product = await prisma.product.create({
      data: {
        categoryId: phones.id,
        title: demo.title,
        description: `${demo.title} — demo catalog entry seeded for the staging deploy.`,
        status: 'PUBLISHED',
      },
    });

    const optionsHash = Buffer.from(JSON.stringify(demo.options)).toString('base64url').slice(0, 64);
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        options: demo.options,
        optionsHash,
        status: 'PUBLISHED',
      },
    });

    await prisma.sellerOffer.create({
      data: {
        sellerId: seller.id,
        variantId: variant.id,
        sku: demo.sku,
        priceMinor: demo.priceMinor,
        currency: 'UZS',
        fulfillmentMode: 'SELLER_WAREHOUSE',
        status: 'ACTIVE',
      },
    });

    console.log(`seeded product: ${demo.title}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
