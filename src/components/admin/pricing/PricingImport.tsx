import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  X,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
  Loader,
  ChevronRight,
} from 'lucide-react';
import { EnrichedPricingEntry, ProductOption } from './usePricingData';
import { activityLogService } from '@/services/activityLog';
import { useAuth } from '@/contexts/AuthContext';

interface ImportRow {
  product_id: number;
  product_name: string;
  contract_price: number;
  rowIndex: number;
  existingEntryId?: string;
  error?: string;
}

interface PricingImportProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  products: ProductOption[];
  entries: EnrichedPricingEntry[];
  orgId: string;
  orgName: string;
  pricingType: 'organization' | 'location';
  onSavePrice: (params: {
    id?: string;
    entityId: string;
    productId: number;
    pricingType: 'organization' | 'location';
    contractPrice?: number;
    minQuantity: number;
  }) => Promise<{ success: boolean; error?: string }>;
}

type Step = 'upload' | 'preview' | 'importing' | 'complete';

const PricingImport: React.FC<PricingImportProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  products,
  entries,
  orgId,
  orgName,
  pricingType,
  onSavePrice,
}) => {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productMap = React.useMemo(() => {
    const map = new Map<number, ProductOption>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const existingPriceMap = React.useMemo(() => {
    const map = new Map<number, EnrichedPricingEntry>();
    entries.forEach((e) => {
      if (e.entity_id === orgId && e.pricing_type === pricingType) {
        map.set(e.product_id, e);
      }
    });
    return map;
  }, [entries, orgId, pricingType]);

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setParsedRows([]);
    setParseError(null);
    setProgress({ current: 0, total: 0 });
    setImportErrors([]);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const parseCSVText = (text: string): ImportRow[] => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

    const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
    const pidIdx = headers.findIndex((h) => h === 'product_id');
    const priceIdx = headers.findIndex((h) => h.includes('contract_price') || h === 'price');

    if (pidIdx === -1) throw new Error('Missing required column: product_id');
    if (priceIdx === -1) throw new Error('Missing required column: contract_price');

    const rows: ImportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const productId = parseInt(cols[pidIdx] || '', 10);
      const priceStr = cols[priceIdx] || '';

      if (!productId || isNaN(productId)) continue; // skip blank rows

      const product = productMap.get(productId);
      const price = parseFloat(priceStr);

      const row: ImportRow = {
        product_id: productId,
        product_name: product?.name || `Unknown (ID: ${productId})`,
        contract_price: price,
        rowIndex: i,
        existingEntryId: existingPriceMap.get(productId)?.id,
      };

      if (!product) {
        row.error = 'Product not found';
      } else if (priceStr === '' || isNaN(price) || price < 0) {
        row.error = 'Invalid price';
      } else if (product.cost != null && price < product.cost) {
        row.error = `Below cost ($${product.cost.toFixed(2)})`;
      }

      rows.push(row);
    }

    if (rows.length === 0) throw new Error('No valid rows found in CSV.');
    return rows;
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setParseError('Please upload a .csv file.');
      return;
    }
    setFileName(file.name);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSVText(text);
        setParsedRows(rows);
        setStep('preview');
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV.');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const validRows = parsedRows.filter((r) => !r.error);

  const handleImport = async () => {
    setStep('importing');
    setProgress({ current: 0, total: validRows.length });
    const errors: string[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const result = await onSavePrice({
        id: row.existingEntryId,
        entityId: orgId,
        productId: row.product_id,
        pricingType,
        contractPrice: row.contract_price,
        minQuantity: 1,
      });
      if (!result.success) {
        errors.push(`Product ${row.product_id} (${row.product_name}): ${result.error}`);
      }
      setProgress({ current: i + 1, total: validRows.length });
    }

    if (user && validRows.length > 0) {
      activityLogService.logAction({
        userId: user.id,
        action: 'pricing_updated',
        resourceType: pricingType,
        resourceId: orgId,
        details: {
          method: 'csv_import',
          org_name: orgName,
          rows_imported: validRows.length - errors.length,
          rows_failed: errors.length,
        },
      });
    }

    setImportErrors(errors);
    setStep('complete');
    onImportComplete();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.stopPropagation()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Import Pricing CSV</h3>
              <p className="text-xs text-gray-500">{orgName}</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Upload a CSV with columns <code className="bg-gray-100 px-1 rounded">product_id</code> and{' '}
                <code className="bg-gray-100 px-1 rounded">contract_price</code>. Use the "Download Template" button to get a pre-filled file.
              </p>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-teal-400 bg-teal-50' : 'border-gray-300 hover:border-teal-400 hover:bg-gray-50'
                }`}
              >
                <Upload className="mx-auto h-8 w-8 text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-700">Drop CSV here or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">.csv files only</p>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </div>

              {parseError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-700">
                  <span className="font-medium">{fileName}</span> — {parsedRows.length} rows found,{' '}
                  <span className="text-green-600 font-medium">{validRows.length} valid</span>
                  {parsedRows.length - validRows.length > 0 && (
                    <span className="text-red-600 font-medium">, {parsedRows.length - validRows.length} with errors</span>
                  )}
                </p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Product ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Contract Price</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedRows.map((row) => (
                      <tr key={row.rowIndex} className={row.error ? 'bg-red-50' : ''}>
                        <td className="px-4 py-2 font-mono text-gray-600">{row.product_id}</td>
                        <td className="px-4 py-2 text-gray-800">{row.product_name}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900">
                          {!row.error ? `$${row.contract_price.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-4 py-2">
                          {row.error ? (
                            <span className="text-xs text-red-600 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> {row.error}
                            </span>
                          ) : row.existingEntryId ? (
                            <span className="text-xs text-amber-600">Update</span>
                          ) : (
                            <span className="text-xs text-green-600">New</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validRows.length === 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  No valid rows to import. Please fix your CSV and try again.
                </div>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader className="h-8 w-8 text-teal-600 animate-spin" />
              <p className="text-sm font-medium text-gray-700">
                Importing {progress.current} / {progress.total}...
              </p>
              <div className="w-64 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900">Import complete</p>
                  <p className="text-sm text-gray-500">
                    {validRows.length - importErrors.length} of {validRows.length} prices saved successfully.
                  </p>
                </div>
              </div>
              {importErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-red-700">{importErrors.length} errors:</p>
                  {importErrors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {step === 'upload' && (
            <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          )}
          {step === 'preview' && (
            <>
              <button onClick={reset} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={validRows.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import {validRows.length} Prices
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          {step === 'complete' && (
            <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PricingImport;
