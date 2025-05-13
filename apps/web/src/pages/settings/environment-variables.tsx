import type { NextPage } from 'next'
import Head from 'next/head'
import SettingsHeader from '@/components/settings/SettingsHeader'
import EnvironmentVariables from '@/components/settings/EnvironmentVariables'
import { BRAND_NAME } from '@/config/constants'

const EnvironmentVariablesPage: NextPage = () => {
  return (
    <>
      <Head>
<<<<<<< HEAD:src/pages/settings/environment-variables.tsx
        <title>{'Zilliqa Safe – Settings – Environment variables'}</title>
=======
        <title>{`${BRAND_NAME} – Settings – Environment variables`}</title>
>>>>>>> v1.51.3:apps/web/src/pages/settings/environment-variables.tsx
      </Head>

      <SettingsHeader />

      <main>
        <EnvironmentVariables />
      </main>
    </>
  )
}

export default EnvironmentVariablesPage
