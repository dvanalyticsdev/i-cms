const mongoose = require('mongoose');

const classAccessCatalogSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default'
    },
    classNames: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true,
    collection: 'class_access_catalog'
  }
);

module.exports = mongoose.model('ClassAccessCatalog', classAccessCatalogSchema);
