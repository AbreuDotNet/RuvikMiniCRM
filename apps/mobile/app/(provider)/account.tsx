import { AccountScreen } from '../../src/features/account/AccountScreen';

export default function ProviderAccount() {
  return (
    <AccountScreen
      extraSections={[
        {
          title: 'Business',
          links: [
            {
              icon: 'storefront-outline',
              title: 'Business profile',
              subtitle: 'What customers see when they find you',
              href: '/business-profile',
            },
            {
              icon: 'pricetags-outline',
              title: 'My listings',
              subtitle: 'The services you offer and their prices',
              href: '/listings',
            },
            {
              icon: 'shield-checkmark-outline',
              title: 'Verification',
              subtitle: 'Documents and review status',
              href: '/verification',
            },
            {
              icon: 'card-outline',
              title: 'Subscription',
              subtitle: 'Your plan and payment history',
              href: '/subscription',
            },
            {
              icon: 'calculator-outline',
              title: 'Tax settings',
              subtitle: 'Default rate and jurisdiction',
              href: '/settings/tax',
            },
          ],
        },
      ]}
    />
  );
}
