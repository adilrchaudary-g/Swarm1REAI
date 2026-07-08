import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hermesClient } from '../../api/hermes-client'
import type { Lead, ContractData } from '../../api/types'
import { SignaturePad } from './SignaturePad'
import { renderOptionAgreement } from './contract-template'
import { X } from 'lucide-react'

interface Props {
  lead: Lead
  onClose: () => void
}

type Step = 'details' | 'terms' | 'preview' | 'sign'

export function ContractWizard({ lead, onClose }: Props) {
  const queryClient = useQueryClient()
  const previewRef = useRef<HTMLDivElement>(null)

  const settings = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => hermesClient.settings.get(),
  })

  const [step, setStep] = useState<Step>('details')
  const [sellerName, setSellerName] = useState(lead.owner_name || '')
  const [sellerAddress, setSellerAddress] = useState(lead.mailing_address || '')
  const [sellerEmail, setSellerEmail] = useState('')
  const [propertyAddress, setPropertyAddress] = useState(lead.address_full || '')
  const [propertyCounty, setPropertyCounty] = useState('')
  const [propertyState, setPropertyState] = useState(lead.address_state || '')
  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserAddress, setPurchaserAddress] = useState('')
  const [optionFee, setOptionFee] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [optionTermEnd, setOptionTermEnd] = useState('')
  const [closingDate, setClosingDate] = useState('')
  const [purchaserSig, setPurchaserSig] = useState<string | null>(null)
  const [sellerSig, setSellerSig] = useState<string | null>(null)
  const [sendMode, setSendMode] = useState<'inperson' | 'email' | null>(null)
  const [contractId, setContractId] = useState<number | null>(null)

  useEffect(() => {
    if (settings.data) {
      setPurchaserName(settings.data.purchaser_name || '')
      setPurchaserAddress(settings.data.purchaser_address || '')
    }
  }, [settings.data])

  useEffect(() => {
    if (lead.email_addresses?.length) {
      setSellerEmail(lead.email_addresses[0])
    }
  }, [lead.email_addresses])

  const amountDue = (Number(purchasePrice) || 0) - (Number(optionFee) || 0)

  const contractData: ContractData = {
    lead_id: lead.lead_id,
    purchaser_name: purchaserName,
    purchaser_address: purchaserAddress,
    seller_name: sellerName,
    seller_address: sellerAddress,
    property_address: propertyAddress,
    property_county: propertyCounty,
    property_state: propertyState,
    option_fee: Number(optionFee) || 0,
    purchase_price: Number(purchasePrice) || 0,
    option_term_end_date: optionTermEnd,
    closing_date: closingDate,
    seller_email: sellerEmail,
  }

  const createContract = useMutation({
    mutationFn: () => hermesClient.contracts.create(contractData),
    onSuccess: (result) => {
      setContractId(result.id)
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
    },
  })

  const signContract = useMutation({
    mutationFn: ({ role, signature }: { role: string; signature: string }) => {
      if (!contractId) throw new Error('No contract')
      return hermesClient.contracts.sign(contractId, role, signature)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      queryClient.invalidateQueries({ queryKey: ['queue-all'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] })
    },
  })

  const sendEmail = useMutation({
    mutationFn: () => {
      if (!contractId) throw new Error('No contract')
      return hermesClient.contracts.send(contractId, sellerEmail)
    },
  })

  const generateAndUploadPdf = async () => {
    if (!contractId || !previewRef.current) return
    const { default: html2canvas } = await import('html2canvas')
    const { jsPDF } = await import('jspdf')

    const canvas = await html2canvas(previewRef.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const imgWidth = 210
    const pageHeight = 297
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    const pdf = new jsPDF('p', 'mm', 'a4')

    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    const blob = pdf.output('blob')
    await hermesClient.contracts.uploadPdf(contractId, blob)
  }

  const handlePurchaserSign = async (dataUrl: string) => {
    setPurchaserSig(dataUrl)
    if (!contractId) {
      const result = await createContract.mutateAsync()
      setContractId(result.id)
      await signContract.mutateAsync({ role: 'purchaser', signature: dataUrl })
    } else {
      await signContract.mutateAsync({ role: 'purchaser', signature: dataUrl })
    }
  }

  const handleSellerSign = async (dataUrl: string) => {
    setSellerSig(dataUrl)
    if (contractId) {
      await signContract.mutateAsync({ role: 'seller', signature: dataUrl })
      await generateAndUploadPdf()
    }
  }

  const handleSendEmail = async () => {
    if (!contractId) return
    await generateAndUploadPdf()
    await sendEmail.mutateAsync()
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0',
    fontSize: 14, outline: 'none',
  }

  const labelStyle = {
    display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4, fontWeight: 500 as const,
  }

  const canProceedDetails = sellerName && propertyAddress && purchaserName
  const canProceedTerms = purchasePrice && optionFee && optionTermEnd && closingDate

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '90vw', maxWidth: 800, maxHeight: '90vh', overflow: 'auto',
        background: '#0f172a', borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.08)', padding: 32,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: 0 }}>Generate Contract</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
              {step === 'details' && 'Step 1 of 4 — Seller & Property'}
              {step === 'terms' && 'Step 2 of 4 — Deal Terms'}
              {step === 'preview' && 'Step 3 of 4 — Preview'}
              {step === 'sign' && 'Step 4 of 4 — Sign & Send'}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
          }}><X size={20} /></button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {(['details', 'terms', 'preview', 'sign'] as Step[]).map((s, i) => (
            <div key={s} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: (['details', 'terms', 'preview', 'sign'].indexOf(step) >= i)
                ? '#6366f1' : 'rgba(255,255,255,0.08)',
            }} />
          ))}
        </div>

        {/* Step 1: Details */}
        {step === 'details' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Seller Name</label>
                <input style={inputStyle} value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Seller Mailing Address</label>
                <input style={inputStyle} value={sellerAddress} onChange={(e) => setSellerAddress(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Seller Email</label>
              <input style={inputStyle} value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)}
                     placeholder="For sending contract" />
            </div>
            <div>
              <label style={labelStyle}>Property Address</label>
              <input style={inputStyle} value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>County</label>
                <input style={inputStyle} value={propertyCounty} onChange={(e) => setPropertyCounty(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <input style={inputStyle} value={propertyState} onChange={(e) => setPropertyState(e.target.value)} />
              </div>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', margin: '8px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Purchaser Name</label>
                <input style={inputStyle} value={purchaserName} onChange={(e) => setPurchaserName(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Purchaser Address</label>
                <input style={inputStyle} value={purchaserAddress} onChange={(e) => setPurchaserAddress(e.target.value)} />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button disabled={!canProceedDetails} onClick={() => setStep('terms')} style={{
                padding: '10px 28px', border: 'none', borderRadius: 8,
                background: canProceedDetails ? '#6366f1' : '#334155',
                color: canProceedDetails ? '#fff' : '#64748b',
                cursor: canProceedDetails ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600,
              }}>Next: Deal Terms</button>
            </div>
          </div>
        )}

        {/* Step 2: Terms */}
        {step === 'terms' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Purchase Price ($)</label>
                <input style={inputStyle} type="number" value={purchasePrice}
                       onChange={(e) => setPurchasePrice(e.target.value)}
                       placeholder="e.g. 85000" />
              </div>
              <div>
                <label style={labelStyle}>Option Fee ($)</label>
                <input style={inputStyle} type="number" value={optionFee}
                       onChange={(e) => setOptionFee(e.target.value)}
                       placeholder="e.g. 1000" />
              </div>
            </div>
            {purchasePrice && optionFee && (
              <div style={{
                padding: '12px 16px', background: 'rgba(99,102,241,0.08)',
                borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)',
              }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Amount Due at Closing: </span>
                <span style={{ color: '#22c55e', fontSize: 16, fontWeight: 600 }}>
                  ${amountDue.toLocaleString()}
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Option Term End Date</label>
                <input style={inputStyle} type="date" value={optionTermEnd}
                       onChange={(e) => setOptionTermEnd(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Closing Date</label>
                <input style={inputStyle} type="date" value={closingDate}
                       onChange={(e) => setClosingDate(e.target.value)} />
              </div>
            </div>
            {lead.mao && (
              <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 12, color: '#64748b' }}>
                MAO: ${lead.mao.toLocaleString()} | ARV: ${(lead.arv_estimate || 0).toLocaleString()}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button onClick={() => setStep('details')} style={{
                padding: '10px 24px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
              }}>Back</button>
              <button disabled={!canProceedTerms} onClick={() => setStep('preview')} style={{
                padding: '10px 28px', border: 'none', borderRadius: 8,
                background: canProceedTerms ? '#6366f1' : '#334155',
                color: canProceedTerms ? '#fff' : '#64748b',
                cursor: canProceedTerms ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600,
              }}>Next: Preview</button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div>
            <div ref={previewRef} style={{
              background: '#fff', borderRadius: 8, overflow: 'auto',
              maxHeight: '60vh', marginBottom: 16,
            }} dangerouslySetInnerHTML={{
              __html: renderOptionAgreement(contractData, purchaserSig || undefined, sellerSig || undefined),
            }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button onClick={() => setStep('terms')} style={{
                padding: '10px 24px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
              }}>Edit</button>
              <button onClick={() => setStep('sign')} style={{
                padding: '10px 28px', border: 'none', borderRadius: 8,
                background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              }}>Next: Sign & Send</button>
            </div>
          </div>
        )}

        {/* Step 4: Sign & Send */}
        {step === 'sign' && (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Purchaser signature */}
            {!purchaserSig ? (
              <div>
                <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>Your Signature (Purchaser)</h3>
                <SignaturePad onSign={handlePurchaserSign} />
                {(createContract.isPending || signContract.isPending) && (
                  <p style={{ color: '#6366f1', fontSize: 13, marginTop: 8 }}>Creating contract...</p>
                )}
              </div>
            ) : (
              <div style={{
                padding: 16, background: 'rgba(34,197,94,0.08)', borderRadius: 8,
                border: '1px solid rgba(34,197,94,0.2)',
              }}>
                <p style={{ color: '#22c55e', fontSize: 14, fontWeight: 600 }}>Purchaser Signed</p>
                <img src={purchaserSig} alt="Purchaser signature" style={{ height: 48, marginTop: 4 }} />
              </div>
            )}

            {/* After purchaser signs, show send options */}
            {purchaserSig && !sendMode && (
              <div>
                <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 12 }}>How should the seller sign?</h3>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button onClick={() => setSendMode('inperson')} style={{
                    flex: 1, padding: '16px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                    background: 'rgba(255,255,255,0.03)', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Sign Now</p>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Hand device to seller to sign in person</p>
                  </button>
                  <button onClick={() => setSendMode('email')} style={{
                    flex: 1, padding: '16px', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10,
                    background: 'rgba(99,102,241,0.08)', color: '#e2e8f0', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Email to Seller</p>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Send signing link to seller's email</p>
                  </button>
                </div>
              </div>
            )}

            {/* In-person seller signing */}
            {sendMode === 'inperson' && !sellerSig && (
              <div>
                <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>Seller Signature</h3>
                <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Hand the device to the seller to sign below</p>
                <SignaturePad onSign={handleSellerSign} />
              </div>
            )}

            {/* Email to seller */}
            {sendMode === 'email' && (
              <div>
                <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>Send to Seller</h3>
                <label style={labelStyle}>Seller Email</label>
                <input style={{ ...inputStyle, marginBottom: 12 }} value={sellerEmail}
                       onChange={(e) => setSellerEmail(e.target.value)} placeholder="seller@email.com" />
                {!sendEmail.isSuccess ? (
                  <button onClick={handleSendEmail}
                    disabled={!sellerEmail || sendEmail.isPending}
                    style={{
                      width: '100%', padding: '12px', border: 'none', borderRadius: 8,
                      background: sellerEmail ? '#6366f1' : '#334155',
                      color: sellerEmail ? '#fff' : '#64748b',
                      cursor: sellerEmail ? 'pointer' : 'not-allowed',
                      fontSize: 14, fontWeight: 600,
                    }}
                  >{sendEmail.isPending ? 'Sending...' : 'Send Contract for Signing'}</button>
                ) : (
                  <div style={{
                    padding: 16, background: 'rgba(34,197,94,0.08)', borderRadius: 8,
                    border: '1px solid rgba(34,197,94,0.2)',
                  }}>
                    <p style={{ color: '#22c55e', fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>
                      Contract sent to {sellerEmail}
                    </p>
                    <p style={{ color: '#94a3b8', fontSize: 12, margin: 0 }}>
                      The seller will receive an email with a link to review and sign.
                      The contract status will update automatically once they sign.
                    </p>
                  </div>
                )}
                {sendEmail.isError && (
                  <p style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>
                    {sendEmail.error instanceof Error ? sendEmail.error.message : 'Failed to send'}
                  </p>
                )}
              </div>
            )}

            {/* Fully signed */}
            {sellerSig && (
              <div style={{
                padding: 20, background: 'rgba(34,197,94,0.08)', borderRadius: 10,
                border: '1px solid rgba(34,197,94,0.2)', textAlign: 'center',
              }}>
                <p style={{ color: '#22c55e', fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
                  Contract Fully Signed!
                </p>
                <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>
                  Lead has been moved to "under_contract" status.
                </p>
                <button onClick={onClose} style={{
                  padding: '10px 24px', border: 'none', borderRadius: 8,
                  background: '#6366f1', color: '#fff', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600,
                }}>Done</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
