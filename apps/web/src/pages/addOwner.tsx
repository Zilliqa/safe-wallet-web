import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useContext, useEffect } from 'react'
import { TxModalContext } from '@/components/tx-flow'
import { AddOwnerFlow } from '@/components/tx-flow/flows'
import { AppRoutes } from '@/config/routes'
import { BRAND_NAME } from '@/config/constants'

const AddOwner: NextPage = () => {
  const router = useRouter()
  const { address } = router.query
  const ownerAddress = Array.isArray(address) ? address[0] : address
  const { setTxFlow } = useContext(TxModalContext)

  useEffect(() => {
    router.push({ pathname: AppRoutes.settings.setup, query: router.query }).then(() => {
      if (!ownerAddress) return

      setTxFlow(<AddOwnerFlow address={ownerAddress} />)
    })
  }, [ownerAddress, router, setTxFlow])

  return (
    <>
      <Head>
<<<<<<< HEAD:src/pages/addOwner.tsx
        <title>{'Zilliqa Safe – Add Signer'}</title>
=======
        <title>{`${BRAND_NAME} – Add Signer`}</title>
>>>>>>> v1.51.3:apps/web/src/pages/addOwner.tsx
      </Head>
    </>
  )
}

export default AddOwner
