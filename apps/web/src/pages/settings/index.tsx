import { useEffect } from 'react'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { generalSettingsNavItems, settingsNavItems } from '@/components/sidebar/SidebarNavigation/config'
import { BRAND_NAME } from '@/config/constants'

const Settings: NextPage = () => {
  const router = useRouter()

  useEffect(() => {
    const redirectPath = router.query.safe ? settingsNavItems[0].href : generalSettingsNavItems[0].href
    router.push(redirectPath, {
      query: router.query,
    })
  }, [router, router.query.safe])

  return (
    <>
      <Head>
<<<<<<< HEAD:src/pages/settings/index.tsx
        <title>{'Zilliqa Safe – Settings'}</title>
=======
        <title>{`${BRAND_NAME} – Settings`}</title>
>>>>>>> v1.51.3:apps/web/src/pages/settings/index.tsx
      </Head>
    </>
  )
}

export default Settings
