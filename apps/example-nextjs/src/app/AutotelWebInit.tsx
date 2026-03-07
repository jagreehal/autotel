'use client'

import { useEffect } from 'react'
import { init } from 'autotel-web'

export function AutotelWebInit() {
  useEffect(() => {
    init({ service: 'example-nextjs' })
  }, [])

  return null
}
