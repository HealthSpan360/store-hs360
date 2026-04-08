import React, { useState, useMemo } from 'react';
import { DollarSign, Plus, RefreshCw, Download, Upload, LayoutGrid, List } from 'lucide-react';
import { usePricingData, EnrichedPricingEntry } from './pricing/usePricingData';
import PricingTable from './pricing/PricingTable';
import PricingForm from './pricing/PricingForm';
import ProductPricingGrid from './pricing/ProductPricingGrid';
import PricingImport from './pricing/PricingImport';
import { activityLogService } from '@/services/activityLog';
import { useAuth } from '@/contexts/AuthContext';

type ViewMode = 'grid' | 'rules';

interface PricingManagementProps {
  organizationId?: string;
}

const PricingManagement: React.FC<PricingManagementProps> = ({ organizationId }) => {
  const { user } = useAuth();
  const {
    entries,
    loading,
    error,
    saving,
    organizations,
    users,
    products,
    fetchPricingData,
    savePricing,
    deletePricing,
  } = usePricingData(organizationId);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<EnrichedPricingEntry | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedOrgId, setSelectedOrgId] = useState(organizationId || '');
  const [selectedEntityType] = useState<'organization'>('organization');
  const isScoped = !!organizationId;

  const selectedOrgName = useMemo(() => {
    if (!selectedOrgId) return '';
    return organizations.find((o) => o.id === selectedOrgId)?.name || selectedOrgId;
  }, [selectedOrgId, organizations]);

  const handleAdd = () => {
    setEditEntry(null);
    setIsFormOpen(true);
  };

  const handleEdit = (entry: EnrichedPricingEntry) => {
    setEditEntry(entry);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditEntry(null);
  };

  const handleSavePricing = async (params: Parameters<typeof savePricing>[0]) => {
    const result = await savePricing(params);
    if (result?.success && user) {
      activityLogService.logAction({
        userId: user.id,
        action: 'pricing_updated',
        resourceType: params.pricingType,
        resourceId: params.entityId,
        details: {
          product_id: params.productId,
          contract_price: params.contractPrice,
          markup_price: params.markupPrice,
          entity_name: selectedOrgName || undefined,
        },
      });
    }
    return result;
  };

  const handleDownloadTemplate = () => {
    const orgPriceMap = new Map<number, number | null>();
    entries.forEach((e) => {
      if (e.entity_id === selectedOrgId && e.pricing_type === selectedEntityType) {
        orgPriceMap.set(e.product_id, e.contract_price);
      }
    });

    const headers = ['product_id', 'sku', 'product_name', 'retail_price', 'contract_price'];
    const rows = products.map((p) => [
      p.id,
      p.sku ?? '',
      `"${p.name.replace(/"/g, '""')}"`,
      p.price.toFixed(2),
      orgPriceMap.has(p.id) ? (orgPriceMap.get(p.id) ?? '').toString() : '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = selectedOrgName.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'pricing';
    a.download = `contract-pricing-template-${safeName}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportRules = () => {
    if (entries.length === 0) return;
    const headers = ['Type', 'Entity', 'Product ID', 'Contract Price', 'Markup Price', 'Min Qty', 'Max Qty', 'Effective Date', 'Expiry Date', 'Updated'];
    const rows = entries.map((e) => [
      e.pricing_type,
      e.entity_name,
      e.product_id,
      e.contract_price || '',
      (e as any).markup_price || '',
      e.min_quantity || '',
      e.max_quantity || '',
      e.effective_date ? new Date(e.effective_date).toLocaleDateString() : '',
      e.expiry_date ? new Date(e.expiry_date).toLocaleDateString() : '',
      new Date(e.updated_at).toLocaleDateString(),
    ]);
    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contract-pricing-rules-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={isScoped ? 'space-y-4' : 'p-6 space-y-6'}>
      {/* Header — hidden when scoped to a specific org */}
      {!isScoped && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-teal-50 rounded-xl">
                <DollarSign className="h-6 w-6 text-teal-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Contract Pricing</h2>
                <p className="text-sm text-gray-500">
                  Set and manage pricing rules for customers and users
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={fetchPricingData}
                className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Refresh
              </button>
              <button
                onClick={handleAdd}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Rule
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Total Rules</div>
              <div className="text-2xl font-bold text-gray-900">{entries.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Unique Customers</div>
              <div className="text-2xl font-bold text-emerald-600">
                {new Set(entries.filter((e) => e.pricing_type === 'organization').map((e) => e.entity_id)).size}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Unique Products</div>
              <div className="text-2xl font-bold text-sky-600">
                {new Set(entries.map((e) => e.product_id)).size}
              </div>
            </div>
          </div>
        </>
      )}

      {/* View Mode Tabs — hidden when scoped to a specific org */}
      {!isScoped && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            All Products
          </button>
          <button
            onClick={() => setViewMode('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'rules' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <List className="h-4 w-4" />
            Pricing Rules
          </button>
        </div>
      )}

      {/* All Products view */}
      {(isScoped || viewMode === 'grid') && (
        <div className="space-y-4">
          {/* Org selector + actions */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            {!isScoped && (
              <>
                <h3 className="text-sm font-semibold text-gray-700">Set Pricing For Customer</h3>
                <div className="flex flex-wrap gap-3">
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="">— Select a customer —</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} {o.code ? `(${o.code})` : ''}
                      </option>
                    ))}
                  </select>

                  {selectedOrgId && (
                    <div className="flex gap-2">
                      <button
                        onClick={handleDownloadTemplate}
                        disabled={products.length === 0}
                        className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Download CSV template pre-populated with all products"
                      >
                        <Download className="h-4 w-4 mr-1.5" />
                        Template
                      </button>
                      <button
                        onClick={() => setIsImportOpen(true)}
                        className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-teal-600 border border-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        Import CSV
                      </button>
                    </div>
                  )}
                </div>

                {!selectedOrgId && (
                  <p className="text-xs text-gray-400">
                    Select a customer above to view and edit product prices inline. You can also download a pre-filled CSV template and import bulk changes.
                  </p>
                )}
              </>
            )}

            {isScoped && selectedOrgId && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadTemplate}
                    disabled={products.length === 0}
                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Download CSV template pre-populated with all products"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Template
                  </button>
                  <button
                    onClick={() => setIsImportOpen(true)}
                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-teal-600 border border-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                  >
                    <Upload className="h-4 w-4 mr-1.5" />
                    Import CSV
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedOrgId ? (
            <ProductPricingGrid
              products={products}
              entries={entries}
              orgId={selectedOrgId}
              pricingType={selectedEntityType}
              onSavePrice={handleSavePricing}
              onDeletePrice={deletePricing}
              saving={saving}
            />
          ) : (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl py-16 text-center text-gray-400">
              <LayoutGrid className="mx-auto h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">Select a customer to manage pricing</p>
              <p className="text-xs mt-1">All products will be listed so you can set prices inline</p>
            </div>
          )}
        </div>
      )}

      {/* Pricing Rules view */}
      {!isScoped && viewMode === 'rules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={handleExportRules}
              disabled={entries.length === 0}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export Rules
            </button>
          </div>
          <PricingTable
            entries={entries}
            loading={loading}
            onEdit={handleEdit}
            onDelete={deletePricing}
            deleting={saving}
          />
        </div>
      )}

      <PricingForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        onSave={handleSavePricing}
        saving={saving}
        organizations={organizations}
        users={users}
        editEntry={editEntry}
        products={products}
      />

      {isImportOpen && selectedOrgId && (
        <PricingImport
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onImportComplete={() => { fetchPricingData(); }}
          products={products}
          entries={entries}
          orgId={selectedOrgId}
          orgName={selectedOrgName}
          pricingType={selectedEntityType}
          onSavePrice={handleSavePricing}
        />
      )}
    </div>
  );
};

export default PricingManagement;
