import React, { useState, useEffect, useMemo } from 'react';
import { X, DollarSign, Building2, User, Calendar, Hash, AlertTriangle } from 'lucide-react';
import { EnrichedPricingEntry, ProductOption } from './usePricingData';

type PricingType = 'individual' | 'organization';

interface OrganizationOption {
  id: string;
  name: string;
  code: string;
}

interface UserOption {
  id: string;
  email: string;
  full_name?: string;
}

interface PricingFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: {
    id?: string;
    entityId: string;
    productId: number;
    pricingType: PricingType;
    contractPrice?: number;
    markupPrice?: number;
    minQuantity: number;
    maxQuantity?: number;
    effectiveDate?: string;
    expiryDate?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  saving: boolean;
  organizations: OrganizationOption[];
  users: UserOption[];
  editEntry?: EnrichedPricingEntry | null;
  preselectedProductId?: number;
  products?: ProductOption[];
}

const PricingForm: React.FC<PricingFormProps> = ({
  isOpen,
  onClose,
  onSave,
  saving,
  organizations,
  users,
  editEntry,
  preselectedProductId,
  products = [],
}) => {
  const [pricingType, setPricingType] = useState<PricingType>('organization');
  const [entityId, setEntityId] = useState('');
  const [productId, setProductId] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [markupPrice, setMarkupPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('1');
  const [maxQuantity, setMaxQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [useMarkup, setUseMarkup] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [entitySearch, setEntitySearch] = useState('');

  // Look up cost for the selected product
  const selectedProductCost = useMemo(() => {
    if (!productId) return null;
    const product = products.find(p => p.id === Number(productId));
    return product?.cost ?? null;
  }, [productId, products]);

  useEffect(() => {
    if (editEntry) {
      setPricingType(editEntry.pricing_type);
      setEntityId(editEntry.entity_id);
      setProductId(String(editEntry.product_id));
      setContractPrice(editEntry.contract_price ? String(editEntry.contract_price) : '');
      setMarkupPrice((editEntry as any).markup_price ? String((editEntry as any).markup_price) : '');
      setUseMarkup(!!(editEntry as any).markup_price);
      setMinQuantity(String(editEntry.min_quantity || 1));
      setMaxQuantity(editEntry.max_quantity ? String(editEntry.max_quantity) : '');
      setEffectiveDate(editEntry.effective_date ? editEntry.effective_date.split('T')[0] : '');
      setExpiryDate(editEntry.expiry_date ? editEntry.expiry_date.split('T')[0] : '');
    } else {
      setPricingType('organization');
      setEntityId('');
      setProductId(preselectedProductId ? String(preselectedProductId) : '');
      setContractPrice('');
      setMarkupPrice('');
      setUseMarkup(false);
      setMinQuantity('1');
      setMaxQuantity('');
      setEffectiveDate('');
      setExpiryDate('');
    }
    setFormError(null);
    setEntitySearch('');
  }, [editEntry, isOpen, preselectedProductId]);

  if (!isOpen) return null;

  const filteredEntities = (() => {
    const term = entitySearch.toLowerCase();
    if (pricingType === 'organization') {
      return organizations.filter(
        (o) =>
          o.name.toLowerCase().includes(term) ||
          o.code.toLowerCase().includes(term)
      );
    }
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(term) ||
        (u.full_name || '').toLowerCase().includes(term)
    );
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!entityId) {
      setFormError('Please select an entity');
      return;
    }
    if (!productId || isNaN(Number(productId))) {
      setFormError('Please enter a valid Product ID');
      return;
    }
    if (!useMarkup && (!contractPrice || isNaN(Number(contractPrice)))) {
      setFormError('Please enter a valid contract price');
      return;
    }
    if (useMarkup && (!markupPrice || isNaN(Number(markupPrice)))) {
      setFormError('Please enter a valid markup price');
      return;
    }

    // Enforce cost floor
    if (!useMarkup && selectedProductCost != null && Number(contractPrice) < selectedProductCost) {
      setFormError(`Price $${Number(contractPrice).toFixed(2)} is below product cost $${selectedProductCost.toFixed(2)}. Cost is the absolute floor.`);
      return;
    }

    const result = await onSave({
      id: editEntry?.id,
      entityId,
      productId: Number(productId),
      pricingType,
      contractPrice: useMarkup ? undefined : Number(contractPrice),
      markupPrice: useMarkup ? Number(markupPrice) : undefined,
      minQuantity: Number(minQuantity) || 1,
      maxQuantity: maxQuantity ? Number(maxQuantity) : undefined,
      effectiveDate: effectiveDate || undefined,
      expiryDate: expiryDate || undefined,
    });

    if (result.success) {
      onClose();
    } else {
      setFormError(result.error || 'Failed to save pricing');
    }
  };

  const typeIcons = {
    organization: <Building2 className="h-4 w-4" />,
    individual: <User className="h-4 w-4" />,
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
        />

        <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg transform transition-all">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-teal-50 rounded-lg">
                <DollarSign className="h-5 w-5 text-teal-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                {editEntry ? 'Edit Contract Price' : 'Add Contract Price'}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Pricing Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['organization', 'individual'] as PricingType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setPricingType(type);
                      setEntityId('');
                      setEntitySearch('');
                    }}
                    disabled={!!editEntry}
                    className={`flex items-center justify-center space-x-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      pricingType === type
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    } ${editEntry ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {typeIcons[type]}
                    <span className="capitalize">{type}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {pricingType === 'organization' ? 'Organization' : 'User'}
              </label>
              <input
                type="text"
                placeholder={`Search ${pricingType}s...`}
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent mb-2"
              />
              <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg">
                {filteredEntities.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    No results found
                  </div>
                ) : (
                  filteredEntities.map((entity: any) => {
                    const id = entity.id;
                    const isSelected = entityId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setEntityId(id)}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-gray-100 last:border-0 ${
                          isSelected
                            ? 'bg-teal-50 text-teal-800'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="font-medium">
                          {entity.name || entity.email}
                        </div>
                        {entity.code && (
                          <div className="text-xs text-gray-500">{entity.code}</div>
                        )}
                        {entity.organization_name && (
                          <div className="text-xs text-gray-400">
                            {entity.organization_name}
                          </div>
                        )}
                        {entity.full_name && (
                          <div className="text-xs text-gray-500">{entity.full_name}</div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Hash className="h-3.5 w-3.5 inline mr-1" />
                Product ID
              </label>
              <input
                type="number"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                placeholder="e.g. 112"
                disabled={!!editEntry}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Price
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useMarkup}
                    onChange={(e) => setUseMarkup(e.target.checked)}
                    className="h-3.5 w-3.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                  />
                  <span className="text-xs text-gray-600">Use markup price</span>
                </label>
              </div>
              {useMarkup ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={markupPrice}
                    onChange={(e) => setMarkupPrice(e.target.value)}
                    placeholder="Markup price above retail"
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  />
                </div>
              ) : (
                <>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min={selectedProductCost != null ? selectedProductCost : 0}
                      value={contractPrice}
                      onChange={(e) => setContractPrice(e.target.value)}
                      placeholder="Contract price"
                      className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                        contractPrice && selectedProductCost != null && Number(contractPrice) < selectedProductCost
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300'
                      }`}
                    />
                  </div>
                  {selectedProductCost != null && (
                    <p className={`text-xs mt-1 ${
                      contractPrice && Number(contractPrice) < selectedProductCost
                        ? 'text-red-600 font-medium'
                        : 'text-gray-500'
                    }`}>
                      {contractPrice && Number(contractPrice) < selectedProductCost ? (
                        <><AlertTriangle className="h-3 w-3 inline mr-1" />Price is below cost</>
                      ) : (
                        <>Cost floor: ${selectedProductCost.toFixed(2)}</>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Min Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={minQuantity}
                  onChange={(e) => setMinQuantity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={maxQuantity}
                  onChange={(e) => setMaxQuantity(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-3.5 w-3.5 inline mr-1" />
                  Effective Date
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-3.5 w-3.5 inline mr-1" />
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {saving && (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                )}
                <span>{editEntry ? 'Update' : 'Create'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PricingForm;
